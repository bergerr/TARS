var Botkit = require('botkit');
var mongoose = require('mongoose');
var request = require('superagent');
var cheerio = require('cheerio');
var isUrl = require('is-url');
var lists = require('./lists.js');
var express = require('express');
var path = require('path');
var moment = require('moment');

// consts
const SMMRY_TOKEN = process.env.SMMRY_TOKEN;
const SLACK_TOKEN = process.env.SLACK_TOKEN;
const PORT = process.env.PORT || 5000;

express().listen(PORT);

var defaultErr = "I'm sorry, Dave, I'm afraid I can't do that.";

// export lists
var LIST_FUCK = lists.fuckOff;
var LIST_SITES = lists.sitesToSummarize;
var LIST_MENUS = lists.menus;
var LIST_PEOPLE = lists.people;

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

controller.spawn({
    retry: true,
    token: process.env.SLACK_TOKEN,
}).startRTM();

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
    var messageText = 'Upcoming food trucks:';
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

            for (key in sorted) {
                var mergedKey = sorted[key];
                var today = moment().format('MMMM-DD-YYYY');
                var mergedCompare = moment(mergedKey).format('MMMM-DD-YYYY');
                if (moment(today, 'MMMM-DD-YYYY').isAfter(moment(mergedCompare, 'MMMM-DD-YYYY'))) {
                    // do not show the trucks
                } else {
                    var date = moment(mergedKey).format('MMMM Do YYYY')
                    if (moment(mergedKey).day() === 5) {
                        messageText += '\n\n\n*' + date + '* - _Fidelity_' + mergedJson[mergedKey];
                    } else {
                        messageText += '\n\n\n*' + date + '* - _Courtyard_' + mergedJson[mergedKey];
                    }
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
    var split = message.text.split(' ');
    var leave = false;
    var potentialUrl = '';

    for (key in split) {
        potentialUrl = split[key].substring(1, split[key].length - 1);
        if (isUrl(potentialUrl)) {
            for (site in LIST_SITES) {
                if (potentialUrl.indexOf(LIST_SITES[site]) > -1){
                    var url = potentialUrl;
                    leave = true;
                    break;
                }
            }
            if (leave) {
                break;
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
        for (key in LIST_MENUS) {
            messageText += key + '\n';
        }
    } else if (subject == 'all') {  // list all menus
        for (key in LIST_MENUS) {
            messageText += '*' + key + '* - ' + LIST_MENUS[key] + '\n';
        }
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
    for (key in lunchVote) {
        messageText += lunchVote[key] + '\n'
    }

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

// space odyssey
controller.hears(/^open the .*doors.*/i, ['direct_message','direct_mention','mention','ambient'],function(bot,message) {
    bot.reply(message, defaultErr);
});

//////////////////////////////////////////
//              functions
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

                    if ($(this).attr('href').startsWith('/')) {
                        link = "_No working link_";
                    } else {
                        link = $(this).attr('href');
                    }

                    trucks += '\n ' + $(this).text() + ' - ' + link;
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
                        output += '\n' + $(this).text();
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