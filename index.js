var Botkit = require('botkit');
var mongoose = require('mongoose');
var request = require('superagent');
var cheerio = require('cheerio');
var isUrl = require('is-url');
var lists = require('./lists.js');
var express = require('express');
var path = require('path');

// consts
const SMMRY_TOKEN = process.env.SMMRY_TOKEN;
const SLACK_TOKEN = process.env.SLACK_TOKEN;
const PORT = process.env.PORT || 5000;

express().listen(PORT);

var defaultErr = "I'm sorry, Dave, I'm afraid I can't do that.";

// export lists
var fuck = lists.fuckOff;
var sitesToSummarize = lists.sitesToSummarize;
var menus = lists.menus;

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
    var messageText = 'Food trucks this week:';
    var date = '';
    var currDay = '';
    var link = '';

    // parse food truck html
    request
        .get('http://www.briercreekeatsalternative.com/weeklylineup/')
        .then(function(res) {
            var $ = cheerio.load(res.res.text);
            $('.summary-title-link').each(function(i, element) {
                date = $(this).parent().parent().parent().parent().parent().parent().parent().parent().prev().children().find('h2').text().trim();
                if (i === 0) {
                    messageText += '\n*' + date.substring(0, date.indexOf('|')) + '*';
                    currDay = date;
                }
                if (currDay !== date) {
                    messageText += '\n \n*' + date.substring(0, date.indexOf('|')) +'*';
                    currDay = date;
                }

                if ($(this).attr('href').startsWith('/')) {
                    link = "_No working link_";
                } else {
                    link = $(this).attr('href');
                }

                messageText += '\n ' + $(this).text() + ' - ' + link;
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
        })
        .catch(function(err) {
            console.log(err);
            bot.reply(message, defaultErr);
        });
});

// fuck off as a service
controller.hears(/^fuck off [A-z]+$/i, ['direct_message','direct_mention','mention','ambient'],function(bot,message) {
    var messageArr = message.text.split(' ');
    if (messageArr.length === 3) {
        var subject = messageArr[2];

        if (subject.toLowerCase() === 'random') {
            var people = [
                'Andres',
                'Brett',
                'Jamie',
                'Linda',
                'Lura',
                'Melanie',
                'Rachel',
                'Ryan'
            ]

            var subject = people[Math.floor(Math.random() * people.length)];
        }

        var randomFuck = fuck[Math.floor(Math.random() * fuck.length)];
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
controller.hears(sitesToSummarize, ['direct_message','direct_mention','mention','ambient'],function(bot,message) {
    var split = message.text.split(' ');
    var leave = false;
    var potentialUrl = '';

    for (key in split) {
        potentialUrl = split[key].substring(1, split[key].length - 1);
        if (isUrl(potentialUrl)) {
            for (site in sitesToSummarize) {
                if (potentialUrl.indexOf(sitesToSummarize[site]) > -1){
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
        for (key in menus) {
            messageText += key + '\n';
        }
    } else if (subject == 'all') {  // list all menus
        for (key in menus) {
            messageText += '*' + key + '* - ' + menus[key] + '\n';
        }
    } else {    // get a specific menu
        var site = menus[subject];

        if (menus.hasOwnProperty(subject)) {
            var site = menus[subject];
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

    var day = new Date().getDay();

    if (day === 1 || day === 3) {
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


// functions
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