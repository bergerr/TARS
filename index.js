var Botkit      = require('botkit');
var cheerio     = require('cheerio');
var decode      = require('unescape');
var isUrl       = require('is-url');
var lev         = require('fast-levenshtein');
var moment      = require('moment');
var mongoose    = require('mongoose');
var path        = require('path');
var request     = require('superagent');
var _           = require('lodash');


// exports
var lists       = require('./lists.js');
var auth        = require('./auth.js');

// export lists
var LIST_SITES      = lists.sitesToSummarize;
var LIST_MENUS      = lists.menus;
var LIST_LUNCH      = lists.lunch;
var LIST_TRUCKS     = lists.trucks;
var LIST_ALT_TRUCKS = lists.alt_trucks;
var LIST_KEYS       = auth.keys;

// consts
const SLACK_TOKEN = LIST_KEYS.slack;
const SMMRY_TOKEN = LIST_KEYS.smmry;

var defaultErr = "Uh oh, shit's broke.";

var controller = Botkit.slackbot({
    debug: false,
    stats_optout: true
});

var bot = controller.spawn({
    token: SLACK_TOKEN
});

// handle RTM closure
function start_rtm() {
    bot.startRTM(function(err,bot,payload) {
        if (err) {
            console.log(err);
            console.log('Failed to start RTM')
            return setTimeout(start_rtm, 60000);
        }
        console.log("RTM started!");
    });
}

controller.on('rtm_close', function(bot, err) {
        start_rtm();
});

start_rtm();

// catch all messages
controller.hears(/....+/i, ['direct_message','direct_mention','mention','ambient'],function(bot, message) {
    // ambient
    var sites = new RegExp(LIST_SITES.join('|').replace(/\./g, '\\.'));

    // direct
    var help = lev.get(message.text, 'help');
    var menu = /^menu/;
    var trucks = lev.get(message.text, 'trucks');
    var lunch = lev.get(message.text, 'lunch');
    var java = /^java\d+ .+$/;
    var angular = /^angular\d+ .+$/;
    var python = /^python\d\.\d .+$/;

    if (message.type == 'ambient') {
        switch(true) {
            case sites.test(message.text):
                sitesFunc(bot, message);
                break;
            default:
                // don't respond
                break;
        }
    } else {
        switch(true) {
            case help < 2:
                helpFunc(bot, message, help);
                break;
            case menu.test(message.text):
                menuFunc(bot, message);
                break;
            case trucks < 2:
                trucksFunc(bot, message, trucks);
                break;
            case lunch < 2:
                lunchFunc(bot, message, lunch);
                break;
            case java.test(message.text):
                javaFunc(bot, message);
                break;
            case angular.test(message.text):
                angularFunc(bot, message);
                break;
            case python.test(message.text):
                pythonFunc(bot, message);
                break;
            default:
                var messageText = "I'm not sure what you want me to do.";
                bot.reply(message, messageText);
                break;
        }
    }
});

//////////////////////////////////////////
//              AMBIENT
//////////////////////////////////////////
// article summary
var sitesFunc = function(bot, message) {
    var split = message.text.replace(/\n/g, ' ').split(' ');
    var potentialUrl = '';

    sites:
    for (key in split) {
        potentialUrl = split[key].substring(1, split[key].length - 1);
        if (isUrl(potentialUrl)) {
            for (site in LIST_SITES) {
                if (potentialUrl.indexOf(LIST_SITES[site]) > -1){
                    var url = potentialUrl;
                    break sites;
                }
            }
        }
    }

    var smmryUrl = 'https://api.smmry.com/';
    smmryUrl += '&SM_API_KEY=' + SMMRY_TOKEN;
    smmryUrl += '&SM_WITH_BREAK=true';
    smmryUrl += '&SM_LENGTH=3';
    smmryUrl += '&SM_QUESTION_AVOID=true';
    smmryUrl += '&SM_URL=' + url;

    request
        .post(smmryUrl)
        .then(function(res) {
            // check if smmry returned well
            if (res.body.sm_api_content) {
                var messageText = "*Here's your article summary:*\n\n"
                messageText += res.body.sm_api_content.replace(/\[BREAK\]/g, '\n\n');

                var remaining = (res.body.sm_api_limitation.replace(/^\D+0\D+/g, '').replace(/\D+$/g, ''));
                if (remaining.length === 1) {
                    messageText += '\n Only ' + remaining + ' summaries left today!';
                }
                bot.reply(message, messageText);
            } else {
                console.log('SMMRY: ' + smmryUrl + ' - ' + res.body.sm_api_message);
            }
        })
        .catch(function(err) {
            console.log(err);
            bot.reply(message, defaultErr);
        })
};

//////////////////////////////////////////
//              DIRECT
//////////////////////////////////////////
// list uses
var helpFunc = function(bot, message, distance) {
    var messageText = '';
    if (distance > 0) {
        messageText = '"*' + message.text + "*\"? Really? Fine, I _guess_ that's close enough...\n\n"
    }

    messageText += "Here are your options:";
    messageText += '\n *trucks* - tell me what food trucks are here this week';
    messageText += '\n *menu list* - show the menu options';
    messageText += '\n *menu all* - show every menu';
    messageText += '\n *menu <restaurant>* - show a specific menu';
    messageText += '\n *lunch* - vote for lunch';
    messageText += '\n *java<#> <class>* - pick a java version and class and show the docs url';
    messageText += '\n *angular<#> <function>* - pick an angular version and function and show the docs url';
    messageText += '\n *python<#> <function>* - pick a python version and function and show the docs url';
    bot.reply(message, messageText);
};

// menus
var menuFunc = function(bot, message) {
    var messageArr = message.text.split('menu ');
    var messageText = '';

    var subject = messageArr[1].toLowerCase();

    if (subject == 'list') {    // list all menus options
        messageText += '*Here are your options:*' + '\n';
        _.forEach(LIST_MENUS, function(value, key) {
            messageText += key + '\n';
        });
    } else if (subject == 'all') {  // list all menus
        _.forEach(LIST_MENUS, function(value, key) {
            messageText += '*' + key + '* - ' + value + '\n';
        });
    } else {    // get a specific menu
        var site = LIST_MENUS[subject];

        if (LIST_MENUS.hasOwnProperty(subject)) {
            var site = LIST_MENUS[subject];
            messageText += '*' + subject + '* - ' + site;
        } else {
            messageText += 'No menu found';
        }
    }

    var post = {
        channel: message.channel,
        text: messageText,
        unfurl_links: false,
        unfurl_media: false
    };

    // slack api post to prevent unfurling
    request
        .post('https://slack.com/api/chat.postMessage')
        .send(post)
        .set('Accept', 'application/json')
        .set('Authorization', 'Bearer ' + SLACK_TOKEN)
        .then(function(res) {
            // do nothing
        })
        .catch(function(err) {
            console.log(err);
            bot.reply(message, defaultErr);
        });
};

// list food trucks
var trucksFunc = function(bot, message, distance) {
    var messageText = '';
    if (distance > 0) {
        messageText = '"*' + message.text + "*\"? Really? Fine, I _guess_ that's close enough...\n\n"
    }

    messageText += 'Upcoming food trucks this week:';
    var currDay = '';
    var link = '';

    // parse food truck html
    localTrucks().then(function(res) {
        var localOut = res;

        // parse frontier food trucks
        frontierTrucks().then(function(res) {
            var append = '';
            var mergedJson;
            if (res == defaultErr) {
                mergedJson = {...localOut};
                append = '\n\n *Error* - Could not fetch Frontier trucks. View them here: https://www.rtp.org/program/rtp-food-truck-rodeo/'
            } else {
                mergedJson = {...localOut, ...res};
            }

            var sorted = Object.keys(mergedJson).sort();

            _.forEach(sorted, function(value) {
                var mergedKey = value;
                var today = moment().format('MMMM-DD-YYYY');
                var momentToday = moment(today, 'MMMM-DD-YYYY');
                var mergedCompare = moment(mergedKey).format('MMMM-DD-YYYY');
                var momentMerged = moment(mergedCompare, 'MMMM-DD-YYYY');

                if (momentToday.isAfter(momentMerged) ||
                    (momentToday.day() > momentMerged.day() && momentToday.day() < 6) ||
                    momentMerged.date() >= moment().date() + 7) {
                    // do not show the trucks
                } else {
                    var date = moment(mergedKey).format('MMMM Do YYYY')
                    if (moment(mergedKey).day() === 5) {
                        messageText += '\n\n\n*' + date + '* - _Fidelity_' + mergedJson[mergedKey];
                    } else {
                        messageText += '\n\n\n*' + date + '* - _Courtyard_' + mergedJson[mergedKey];
                    }
                }
            });

            messageText += append;

            var post = {
                channel: message.channel,
                text: messageText,
                unfurl_links: false,
                unfurl_media: false
            };

            // slack api post to prevent unfurling
            request
                .post('https://slack.com/api/chat.postMessage')
                .send(post)
                .set('Accept', 'application/json')
                .set('Authorization', 'Bearer ' + SLACK_TOKEN)
                .then(function(res) {
                    // do nothing
                })
                .catch(function(err) {
                    console.log(err);
                    bot.reply(message, defaultErr);
                });

        }).catch(function(err) {
            console.log(err);
            bot.reply(message, defaultErr);
        });

    })
    .catch(function(err) {
        console.log(err);
        bot.reply(message, defaultErr);
    });
};

// lunch vote
var lunchFunc = function(bot, message, distance) {
    var messageText = '';
    if (distance > 0) {
        messageText = '"*' + message.text + "*\"? Really? Fine, I _guess_ that's close enough...\n\n"
    }

    _.forEach(LIST_LUNCH, function(value) {
        messageText += value + '\n';
    });

    var day = moment().day();

    if (day === 1 || day === 3 || day === 5) {
        messageText += ':truck: food trucks'
    }

    bot.reply(message, messageText);
};

// java
var javaFunc = function(bot, message) {
    var messageText = '';
    var tokens = message.text.split(' ');
    var version = tokens[0].replace(/\D+/g, '');
    var search = tokens[1];
    var baseUrl = 'https://docs.oracle.com/javase/' + version + '/docs/api/';

    request
        .get(baseUrl + 'allclasses-frame.html')
        .then(function(res) {
            var $ = cheerio.load(res.text);
            var element = $('li').filter(function() {
                return $(this).text().trim() === search;
            }).children().attr('href');
            if (!element) {
                messageText = 'No class found with that name.'
                bot.reply(message, messageText);
            } else {
                messageText = baseUrl + element;
                stackOverflow('java', search).then(function(res) {
                    var post = {
                        channel: message.channel,
                        text: messageText + res,
                        unfurl_links: false,
                        unfurl_media: false
                    };

                    // slack api post to prevent unfurling
                    request
                        .post('https://slack.com/api/chat.postMessage')
                        .send(post)
                        .set('Accept', 'application/json')
                        .set('Authorization', 'Bearer ' + SLACK_TOKEN)
                        .then(function(res) {
                            // do nothing
                        })
                        .catch(function(err) {
                            console.log(err);
                            bot.reply(message, defaultErr);
                        });
                }).catch(function(err) {
                    console.log(err);
                    bot.reply(message, messageText);
                });
            }
        })
        .catch(function(err) {
            console.log(tokens[0] + ': ' + err.status);
            if (err.status === 404) {
                bot.reply(message, 'That version of Java could not be found.');
            } else {
                bot.reply(message, defaultErr);
            }

        });
};

// angular
var angularFunc = function(bot, message) {
    var messageText = '';
    var tokens = message.text.split(' ');
    var version = tokens[0].replace(/\D+/g, '');
    var search = tokens[1];
    var baseUrl = '';
    var extension = '';

    switch (version) {
        case '2':
            baseUrl = 'https://v2.angular.io/';
            extension = 'docs/ts/latest/api/api-list.json';
            break;
        case '4':
            baseUrl = 'https://v4.angular.io/';
            extension = 'generated/docs/api/api-list.json';
            break;
        case '5':
            baseUrl = 'https://v5.angular.io/';
            extension = 'generated/docs/api/api-list.json';
            break;
        case '6':
            baseUrl = 'https://angular.io/';
            extension = 'generated/docs/api/api-list.json';
            break;
        default:
            bot.reply(message, 'That version of Angular could not be found.');
            return;
    }

    request
        .get(baseUrl + extension)
        .set('Accept', 'application/json')
        .then(function(res) {
            // angular 2 json is a different structure
            if (version > 2) {
                var outArr = [];
                _.forEach(res.body, function(value) {
                    var find = _.find(value.items, ['name', search.toLowerCase()]);
                    if(find) {
                        outArr.push(find);
                    }
                });
                urlReturn(outArr);
            } else {
                var singleArr = [];
                _.forEach(res.body, function(value, key) {
                    singleArr.push(value);
                });
                singleArr = _.flatten(singleArr);
                var outArr = _.filter(singleArr, function(res) {
                    return res['title'].toLowerCase() === search.toLowerCase();
                });
                urlReturn(outArr);
            }
        })
        .catch(function(err) {
            console.log(err);
            bot.reply(message, defaultErr);
        });

    // format json array
    var urlReturn = function(arr) {
        if (arr.length > 1) {
            messageText += 'I found multiple matching functions:\n'
        }
        _.forEach(arr, function(value) {
            messageText += baseUrl + value.path + '\n';
        });
        stackOverflow('angular', search).then(function(res) {
            var post = {
                channel: message.channel,
                text: messageText + res,
                unfurl_links: false,
                unfurl_media: false
            };

            // slack api post to prevent unfurling
            request
                .post('https://slack.com/api/chat.postMessage')
                .send(post)
                .set('Accept', 'application/json')
                .set('Authorization', 'Bearer ' + SLACK_TOKEN)
                .then(function(res) {
                    // do nothing
                })
                .catch(function(err) {
                    console.log(err);
                    bot.reply(message, defaultErr);
                });
        }).catch(function(err) {
            console.log(err);
            bot.reply(message, messageText);
        });
    }
};

// python
var pythonFunc = function(bot, message) {
    var messageText = '';
    var tokens = message.text.split(' ');
    var version = tokens[0].replace(/python/g, '');
    var search = tokens[1];
    var baseUrl = 'https://docs.python.org/' + version + '/';

    request
        .get(baseUrl + 'py-modindex.html')
        .then(function(res) {
            var $ = cheerio.load(res.text);
            var element = $('code').filter(function() {
                return $(this).text().trim() === search;
            }).parent().attr('href');
            if (!element) {
                messageText = 'No function found with that name.'
                bot.reply(message, messageText);
            } else {
                messageText = baseUrl + element;
                stackOverflow('python', search).then(function(res) {
                    var post = {
                        channel: message.channel,
                        text: messageText + res,
                        unfurl_links: false,
                        unfurl_media: false
                    };

                    // slack api post to prevent unfurling
                    request
                        .post('https://slack.com/api/chat.postMessage')
                        .send(post)
                        .set('Accept', 'application/json')
                        .set('Authorization', 'Bearer ' + SLACK_TOKEN)
                        .then(function(res) {
                            // do nothing
                        })
                        .catch(function(err) {
                            console.log(err);
                            bot.reply(message, defaultErr);
                        });
                }).catch(function(err) {
                    console.log(err);
                    bot.reply(message, messageText);
                });

            }
        })
        .catch(function(err) {
            console.log(tokens[0] + ': ' + err.status);
            if (err.status === 404) {
                bot.reply(message, 'That version of Python could not be found.');
            } else {
                bot.reply(message, defaultErr);
            }

        });
};

//////////////////////////////////////////
//              FUNCTIONS
//////////////////////////////////////////
var localTrucks = function() {
    return new Promise(function (resolve, reject) {
        var output = '';
        var trucks = '';
        var json = {};

        request
            .get('https://streetfoodfinder.com/embed/spot/404/calendar/page?dts=2')
            .then(function(res) {
                var $ = cheerio.load(res.res.text);
                $('.blog-title').each(function(i, element) {
                    date = $(this).parent().parent().parent().parent().parent().parent().parent().prev().text().replace('11:30 AM - 1:30 PM','').trim();
                    if (i === 0) {
                        output = moment(date.replace(',',''), 'MMMM Do YYYY').format();
                        json[output] = trucks;
                        currDay = date;
                    }
                    if (currDay !== date) {
                        json[output] = trucks;
                        trucks = '';
                        output = moment(date.replace(',',''), 'MMMM Do YYYY').format();
                        currDay = date;
                    }

                    var truck = $(this).text().trim();
                    var link = '_No working link_';
                    if (LIST_TRUCKS.hasOwnProperty(truck.toLowerCase())) {
                        link = LIST_TRUCKS[truck.toLowerCase()];
                    } else if (LIST_ALT_TRUCKS.hasOwnProperty(truck.toLowerCase())) {
                        link = LIST_ALT_TRUCKS[truck.toLowerCase()];
                    }

                    trucks += '\n ' + truck + ' - ' + link;
                });
                json[output] = trucks;
                resolve(json);

            })
            .catch(function(err) {
                console.log(err);
                resolve(defaultErr);
            });
    });
};

var frontierTrucks = function() {
    return new Promise(function (resolve, reject) {
        var output = '';
        var json = {};

        request
            .get('https://www.rtp.org/program/rtp-food-truck-rodeo/')
            .then(function(res) {
                var $ = cheerio.load(res.res.text);
                var month = $('.simcal-current-month').text();
                var year = $('.simcal-current-year').text();
                $('.simcal-weekday-5').each(function(i, element) {
                    output = '';
                    var day = $(this).find('.simcal-day-number').text();
                    var date = moment(month + ' ' + day + ' ' + year, 'MMMM D YYYY').format();

                    $(this).find('strong').each(function(j, element) {
                        var truck = $(this).text().trim();
                        var link = '_No working link_';
                        if (LIST_TRUCKS.hasOwnProperty(truck.toLowerCase())) {
                            link = LIST_TRUCKS[truck.toLowerCase()];
                        } else if (LIST_ALT_TRUCKS.hasOwnProperty(truck.toLowerCase())) {
                            link = LIST_ALT_TRUCKS[truck.toLowerCase()];
                        }

                        output += '\n' + truck + ' - ' + link;
                    });

                    json[date] = output;
                })
                resolve(json);
            })
            .catch(function(err) {
                console.log('Frontier trucks failed');
                resolve(defaultErr);
            });
    });
};

var stackOverflow = function(language, search) {
    return new Promise(function (resolve, reject) {
        var url = 'https://api.stackexchange.com/2.2/search/advanced'
                + '?order=desc&sort=relevance&accepted=True&tagged='
                + language + '&title=' + search + '&site=stackoverflow';
        var ret = '';

        request
            .get(url)
            .then(function(res) {
                var len = res.body.items.length;
                if (len === 0) {
                    ret += '\n\nNo StackOverflow questions found.'
                    resolve(ret);
                    return;
                } else if (len > 5) {
                    len = 5
                }
                ret += '\n\n*Top ' + len + ' StackOverflow questions:*';
                for (var i = 0; i < len; i++) {
                    ret += '\n' + (i+1) + '. ' + decode(res.body.items[i].title) + '\n      - ' + res.body.items[i].link;
                }
                resolve(ret);
            })
            .catch(function(err) {
                console.log(err);
                reject(err);
            });
    });
};
