/*
 * Copyright (C) 2016-2023 phantombot.github.io/PhantomBot
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/* global Packages */

/**
 * followHandler.js
 *
 * Register new followers and unfollows in the channel
 * Optionally supports rewarding points for a follow (Only the first time!)
 *
 * The follow train:
 * Checks if the previous follow was less than 5 minutes ago.
 * It will trigger on 3, 4, 5, 10 and 20+ followers.
 * anymore to reduce spam. Unless the 5 minutes have past, then it will start over.
 *
 */

(function () {
    let followToggle = $.getSetIniDbBoolean('settings', 'followToggle', false),
            followReward = $.getSetIniDbNumber('settings', 'followReward', 0),
            followMessage = $.getSetIniDbString('settings', 'followMessage', $.lang.get('followhandler.follow.message')),
            followDelay = $.getSetIniDbNumber('settings', 'followDelay', 5),
            followQueue = new Packages.java.util.concurrent.ConcurrentLinkedQueue,
            lastFollow = $.systemTime(),
            announceFollows = false;

    $.bind('eventSubChannelFollow', function (event) {
        if ($.jsString(event.event().broadcasterUserId()) === $.jsString($.username.getIDCaster())) {
            $.followers.addFollow(event.event().userLogin(), event.event().followedAtString());
        }
    }, true);

    $.bind('eventSubWelcome', function (event) {
        if (!event.isReconnect()) {
            let subscriptions = [
                Packages.com.gmt2001.twitch.eventsub.subscriptions.channel.ChannelFollow
            ];

            for (let i in subscriptions) {
                let newSubscription = new subscriptions[i]($.username.getIDCaster());
                try {
                    newSubscription.create().block();
                } catch (ex) {
                    $.log.error(ex);
                }
            }
        }
    }, true);

    /*
     * @function updateFollowConfig
     */
    function updateFollowConfig() {
        followReward = $.getIniDbNumber('settings', 'followReward');
        followMessage = $.getIniDbString('settings', 'followMessage');
        followToggle = $.getIniDbBoolean('settings', 'followToggle');
        followDelay = $.getIniDbNumber('settings', 'followDelay');
    }

    function alertFollow(follower, replay) {
        if (announceFollows && followToggle) {
            let s = followMessage;
            if (s.match(/\(name\)/)) {
                s = $.replace(s, '(name)', $.username.resolve(follower));
            }

            if (s.match(/\(reward\)/)) {
                s = $.replace(s, '(reward)', $.getPointsString(followReward));
            }

            if (s.match(/^\/w/)) {
                s = s.replace('/w', ' /w');
            }

            followQueue.add(s);

            if (followReward > 0 && !replay) {
                $.inidb.incr('points', follower, followReward);
            }

            $.writeToFile(follower + ' ', './addons/followHandler/latestFollower.txt', false);
            $.inidb.set('streamInfo', 'lastFollow', follower);
        }
    }

    /*
     * @function runFollows
     */
    function runFollows() {
        if (!followQueue.isEmpty() && (lastFollow + (followDelay * 1e3)) < $.systemTime()) {
            let s = followQueue.poll();
            if (s === null) {
                return;
            }

            if (s.match(/\(alert [,.\w\W]+\)/g)) {
                let filename = s.match(/\(alert ([,.\w\W]+)\)/)[1];
                $.alertspollssocket.alertImage(filename);
                s = (s + '').replace(/\(alert [,.\w\W]+\)/, '');
            }

            if (s.match(/\(playsound\s([a-zA-Z1-9_]+)\)/g)) {
                if (!$.audioHookExists(s.match(/\(playsound\s([a-zA-Z1-9_]+)\)/)[1])) {
                    $.log.error('Could not play audio hook: Audio hook does not exist.');
                } else {
                    $.alertspollssocket.triggerAudioPanel(s.match(/\(playsound\s([a-zA-Z1-9_]+)\)/)[1]);
                }
                s = $.replace(s, s.match(/\(playsound\s([a-zA-Z1-9_]+)\)/)[0], '');
            }

            if (s !== '') {
                $.say(s);
            }
            lastFollow = $.systemTime();
        }
    }

    /*
     * @event twitchFollowsInitialized
     */
    $.bind('twitchFollowsInitialized', function () {
        $.consoleLn('>> Enabling follower announcements');

        announceFollows = true;
    });

    /*
     * @event twitchFollow
     */
    $.bind('twitchFollow', function (event) {
        let follower = event.getFollower();
        alertFollow(follower, false);
    });

    /*
     * @event command
     */
    $.bind('command', function (event) {
        let sender = event.getSender(),
                command = event.getCommand(),
                args = event.getArgs(),
                action = args[0];

        /*
         * @commandpath followreward [amount] - Set the points reward for following
         */
        if (command.equalsIgnoreCase('followreward')) {
            if (isNaN(parseInt(action))) {
                $.say($.whisperPrefix(sender) + $.lang.get('followhandler.set.followreward.usage', $.pointNameMultiple, followReward));
                return;
            }

            followReward = parseInt(action);
            $.inidb.set('settings', 'followReward', followReward);
            $.say($.whisperPrefix(sender) + $.lang.get('followhandler.set.followreward.success', $.getPointsString(followReward)));
        }

        /*
         * @commandpath followmessage [message] - Set the new follower message when there is a reward
         */
        if (command.equalsIgnoreCase('followmessage')) {
            if (action === undefined) {
                $.say($.whisperPrefix(sender) + $.lang.get('followhandler.set.followmessage.usage'));
                return;
            }

            followMessage = args.slice(0).join(' ');
            $.inidb.set('settings', 'followMessage', followMessage);
            $.say($.whisperPrefix(sender) + $.lang.get('followhandler.set.followmessage.success', followMessage));
        }

        /*
         * @commandpath followdelay [message] - Set the delay in seconds between follow announcements
         */
        if (command.equalsIgnoreCase('followdelay')) {
            if (isNaN(parseInt(action)) || parseInt(action) < 5) {
                $.say($.whisperPrefix(sender) + $.lang.get('followhandler.set.followdelay.usage'));
                return;
            }

            followDelay = parseInt(action);
            $.inidb.set('settings', 'followDelay', followDelay);
            $.say($.whisperPrefix(sender) + $.lang.get('followhandler.set.followdelay.success', followDelay));
        }

        /*
         * @commandpath followtoggle - Enable or disable the anouncements for new followers
         */
        if (command.equalsIgnoreCase('followtoggle')) {
            followToggle = !followToggle;
            $.setIniDbBoolean('settings', 'followToggle', followToggle);
            $.say($.whisperPrefix(sender) + (followToggle ? $.lang.get('followhandler.followtoggle.on') : $.lang.get('followhandler.followtoggle.off')));
        }

        /*
         * @commandpath checkfollow [username] - Check if a user is following the channel
         */
        if (command.equalsIgnoreCase('checkfollow')) {
            if (action === undefined) {
                $.say($.whisperPrefix(sender) + $.lang.get('followhandler.check.usage'));
                return;
            }

            action = $.user.sanitize(action);

            if ($.user.isFollower(action)) {
                $.say($.lang.get('followhandler.check.follows', $.username.resolve(action)));
            } else {
                $.say($.lang.get('followhandler.check.notfollows', $.username.resolve(action)));
            }
        }

        /*
         * @commandpath replayfollow [username] - Replays the follow message for username
         */
        if (command.equalsIgnoreCase('replayfollow')) {
            if (action === undefined) {
                return;
            }
            alertFollow(action, true);
        }
    });

    /*
     * @event initReady
     */
    $.bind('initReady', function () {
        $.registerChatCommand('./handlers/followHandler.js', 'followreward', $.PERMISSION.Admin);
        $.registerChatCommand('./handlers/followHandler.js', 'followtoggle', $.PERMISSION.Admin);
        $.registerChatCommand('./handlers/followHandler.js', 'followdelay', $.PERMISSION.Admin);
        $.registerChatCommand('./handlers/followHandler.js', 'followmessage', $.PERMISSION.Admin);
        $.registerChatCommand('./handlers/followHandler.js', 'checkfollow', $.PERMISSION.Mod);
        $.registerChatCommand('./handlers/followHandler.js', 'replayfollow', $.PERMISSION.Admin);

        setInterval(runFollows, 2e3, 'scripts::handlers::followHandler.js');
    });

    $.updateFollowConfig = updateFollowConfig;
})();
