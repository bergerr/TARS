var Botkit = require('botkit');
var mongoose = require('mongoose');
var request = require('superagent');
var cheerio = require('cheerio');
var isUrl = require('is-url');
var lists = require('./lists.js');
var express = require('express');
var path = require('path');
var moment = require('moment');
var _ = require('lodash');

// consts
const SMMRY_TOKEN = process.env.SMMRY_TOKEN;
const SLACK_TOKEN = process.env.SLACK_TOKEN;
const PORT = process.env.PORT || 5000;

express().listen(PORT);

// export lists
var LIST_FUCK = lists.fuckOff;
var LIST_SITES = lists.sitesToSummarize;
var LIST_MENUS = lists.menus;
var LIST_PEOPLE = lists.people;
var LIST_TRUCKS = lists.trucks;

var defaultErr = "I'm sorry, Dave, I'm afraid I can't do that.";

// lists
var lunchVote = [':cubimal_chick: alpaca chicken', ':pizza: brixx', ':beer: carolina ale house',
                ':chopsticks: champa', ':bird: red robin', ':taco: san jose',
                ':curry: tamarind', ':sushi: tasu', ':pie: your pie'];
var emojiList = ['one', 'two', 'three', 'four', 'five',
                'six', 'seven', 'eight', 'nine', 'keycap_ten'];

var controller = Botkit.slackbot({
    debug: false,
    stats_optout: true
});

var bot = controller.spawn({
    token: process.env.SLACK_TOKEN
});

// handle RTM closure
function start_rtm() {
    bot.startRTM(function(err,bot,payload) {
        if (err) {
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

// list uses
controller.hears(/^help/i, ['direct_message','direct_mention','mention'],function(bot,message) {
    var messageText = "Here are your options:";
    messageText += '\n *trucks* - tell me what food trucks are here this week';
    messageText += '\n *fuck off <someone>* - tell someone to fuck off';
    messageText += '\n *fuck off random* - tell someone random to fuck off';
    messageText += '\n *menu list* - show the menu options';
    messageText += '\n *menu all* - show every menu';
    messageText += '\n *menu <restaurant>* - show a specific menu';
    messageText += '\n *lunch* - vote for lunch';

    bot.reply(message, messageText);
});

// list food trucks
controller.hears(/^trucks/i, ['direct_message','direct_mention','mention'],function(bot,message) {
    var messageText = 'Upcoming food trucks this week:';
    var currDay = '';
    var link = '';

    // parse food truck html
    localTrucks(bot).then(function(res) {
        var localOut = res;

        // parse frontier food trucks
        frontierTrucks(bot).then(function(res) {
            var frontierOut = res;

            var mergedJson = {...localOut, ...frontierOut};
            var sorted = Object.keys(mergedJson).sort();

            _.forEach(sorted, function(value) {
                var mergedKey = value;
                var today = moment().format('MMMM-DD-YYYY');
                var momentToday = moment(today, 'MMMM-DD-YYYY');
                var mergedCompare = moment(mergedKey).format('MMMM-DD-YYYY');
                var momentMerged = moment(mergedCompare, 'MMMM-DD-YYYY');

                if (momentToday.isAfter(momentMerged) ||
                    momentToday.day() > momentMerged.day() ||
                    momentMerged.date() > moment().date() + 7) {
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

        });

    })
    .catch(function(err) {
        console.log(err);
        bot.reply(message, "Uh oh. Shit's broke.");
    });
});

// fuck off as a service
controller.hears(/^fuck off [A-z]+$/i, ['direct_message','direct_mention','mention','ambient'],function(bot,message) {
    var messageArr = message.text.split(' ');
    if (messageArr.length === 3) {
        var subject = messageArr[2];

        if (subject.toLowerCase() === 'random') {
            var subject = LIST_PEOPLE[Math.floor(Math.random() * LIST_PEOPLE.length)];
        }

        var randomFuck = LIST_FUCK[Math.floor(Math.random() * LIST_FUCK.length)];
        var fooas = randomFuck.replace(':name', subject);

        request
            .get('http://foaas.com' + fooas)
            .set('Accept', 'application/json')
            .then(function(res) {
                var messageText = res.body.message;
                bot.reply(message, messageText);
            })
            .catch(function(err) {
                console.log(err);
                bot.reply(message, defaultErr);
            });
    } else {
        bot.reply(message, defaultErr);
    }
});

// article summary
controller.hears(LIST_SITES, ['direct_message','direct_mention','mention','ambient'],function(bot,message) {
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
    smmryUrl += '&SM_URL=' + url;
    smmryUrl += '&SM_WITH_BREAK=true';
    smmryUrl += '&SM_LENGTH=3';
    smmryUrl += '&SM_QUESTION_AVOID=true';

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
                console.log('SMMRY: ' + potentialUrl + ' - ' + res.body.sm_api_message);
            }
        })
        .catch(function(err) {
            console.log(err);
            bot.reply(message, defaultErr);
        })
});

// menus
controller.hears(/^menu/i, ['direct_message','direct_mention','mention'],function(bot,message) {
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
});

// lunch vote
controller.hears(/^lunch/i, ['direct_message','direct_mention','mention'],function(bot,message) {
    var messageText = '';

    _.forEach(lunchVote, function(value) {
        messageText += value + '\n';
    });

    var day = moment().day();

    if (day === 1 || day === 3 || day === 5) {
        messageText += ':truck: food trucks'
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
});

// java
controller.hears(/^java\d+ .+$/i, ['direct_message','direct_mention','mention'],function(bot,message) {
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
                bot.reply(message, messageText);
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
});

// angular
controller.hears(/^angular\d+ .+$/i, ['direct_message','direct_mention','mention'],function(bot,message) {
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
                bot.reply(message, urlReturn(outArr));
            } else {
                var singleArr = [];
                _.forEach(res.body, function(value, key) {
                    singleArr.push(value);
                });
                singleArr = _.flatten(singleArr);
                var outArr = _.filter(singleArr, function(res) {
                    return res['title'].toLowerCase() === search.toLowerCase();
                });
                bot.reply(message, urlReturn(outArr));
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
        return messageText;
    }
});

// snake
controller.hears(/hsss/i, ['direct_message','direct_mention','mention','ambient'],function(bot,message) {
    var messageText = 'https://www.youtube.com/watch?v=Ti4sqG85FU4';
    bot.reply(message, messageText);
});

// space odyssey
controller.hears(/^open the .*doors.*/i, ['direct_message','direct_mention','mention','ambient'],function(bot,message) {
    bot.reply(message, defaultErr);
});

//////////////////////////////////////////
//              FUNCTIONS
//////////////////////////////////////////
var localTrucks = function(bot) {
    return new Promise(function (resolve, reject) {
        var output = '';
        var trucks = '';
        var json = {};

        request
            .get('http://www.briercreekeatsalternative.com/weeklylineup/')
            .then(function(res) {
                var $ = cheerio.load(res.res.text);
                $('.summary-title-link').each(function(i, element) {
                    date = $(this).parent().parent().parent().parent().parent().parent().parent().parent().prev().children().find('h2').text().trim();
                    if (i === 0) {
                        output = moment(date.substring(0, date.indexOf('|')).replace(',',''), 'MMMM Do YYYY').format();
                        currDay = date;
                    }
                    if (currDay !== date) {
                        json[output] = trucks;
                        trucks = '';
                        output = moment(date.substring(0, date.indexOf('|')).replace(',',''), 'MMMM Do YYYY').format();
                        currDay = date;
                    }

                    var truck = $(this).text().trim();
                    var link = '_No working link_';
                    if (!$(this).attr('href').startsWith('/')) {
                        link = $(this).attr('href');
                    }
                    else if (LIST_TRUCKS.hasOwnProperty(truck.toLowerCase())) {
                        link = LIST_TRUCKS[truck.toLowerCase()];
                    }

                    trucks += '\n ' + truck + ' - ' + link;
                });
                json[output] = trucks;
                resolve(json);

            })
            .catch(function(err) {
                console.log(err);
                bot.reply(message, "Uh oh. Shit's broke.");
                reject(err);
            });
    });
}

var frontierTrucks = function(bot) {
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
                        }
                        output += '\n' + truck + ' - ' + link;
                    });

                    json[date] = output;
                })
                resolve(json);
            })
            .catch(function(err) {
                console.log(err);
                bot.reply(message, "Couldn't find food trucks at Fidelity");
                reject(err);
            });
    });
}

var reactChain = function(count, channel, timestamp, end) {
    if (count === end) {
        return;
    }

    var post = {
        channel: channel,
        timestamp: timestamp,
        name: emojiList[count]
    }

    request
        .post('https://slack.com/api/reactions.add')
        .send(post)
        .set('Accept', 'application/json')
        .set('Authorization', 'Bearer ' + SLACK_TOKEN)
        .then(function(res) {
            reactChain(++count, channel, timestamp, end);
        })
        .catch(function(err) {
            console.log(err);
            bot.reply(message, defaultErr);
        });
}