var Combinatorics = require('js-combinatorics');
var config = require('config');
var lodash = require('lodash');
var mongoose = require('mongoose');

var database = require('../database');

function calculateNeededRoles(playersAvailable) {
    var roles = config.get('app.games.roles');
    var roleNames = lodash.keys(roles);

    var neededCombinations = [];

    var n = lodash.size(roles);

    for (var k = 1; k <= n; k++) {
        var combinations = Combinatorics.combination(roleNames, k).toArray();

        lodash.each(combinations, function(combination) {
            var combinationInfo = lodash.reduce(combination, function(current, roleName) {
                return {
                    available: new Set([...current.available, ...playersAvailable[roleName]]),
                    required: current.required + (roles[roleName].min * 2)
                };
            }, {
                available: new Set(),
                required: 0
            });

            var missing = combinationInfo.required - combinationInfo.available.size;

            if (missing > 0) {
                neededCombinations.push({
                    roles: combination,
                    needed: missing
                });
            }
        });
    }

    return neededCombinations;
}

module.exports = function(app, io, self, server) {
    var playersAvailable = lodash.mapValues(config.get('app.games.roles'), function() { return new Set(); });
    var captainsAvailable = new Set();
    var neededRoles = calculateNeededRoles(playersAvailable);

    var prepareStatusMessage = function() {
        var playersAvailableArray = lodash.mapValues(playersAvailable, function(available) {
            return [...available];
        });
        var captainsAvailableArray = [...captainsAvailable];

        var playersInfo = lodash.mapValues(playersAvailableArray, function(availableArray, roleName) {
            return lodash.map(availableArray, function(userID) {
                return lodash.omit(io.sockets.connected[self.userSockets[userID].values().next().value].user.toObject(), ['_id', 'id', '__v']);
            });
        });
        var captainsInfo = lodash.map(captainsAvailableArray, function(userID) {
            return lodash.omit(io.sockets.connected[self.userSockets[userID].values().next().value].user.toObject(), ['_id', 'id', '__v']);
        });
        var neededRolesInfo = lodash.map(neededRoles, function(neededRole) {
            return neededRole;
        });

        return {
            playersAvailable: playersInfo,
            captainsAvailable: captainsInfo,
            neededRoles: neededRolesInfo
        };
    };

    var currentStatusMessage = prepareStatusMessage();

    io.sockets.on('connection', function(socket) {
        socket.emit('statusUpdated', currentStatusMessage);
    });

    io.sockets.on('authenticated', function(socket) {
        socket.on('changeAvailability', function(availability) {
            if (!lodash.includes(socket.restrictions.aspects, 'play')) {
                lodash.forEach(playersAvailable, function(players, role) {
                    if (lodash.includes(availability.roles, role)) {
                        players.add(socket.user.id);
                    }
                    else {
                        players.delete(socket.user.id);
                    }
                });

                if (!lodash.includes(socket.restrictions.aspects, 'captain')) {
                    if (availability.captain) {
                        captainsAvailable.add(socket.user.id);
                    }
                    else {
                        captainsAvailable.delete(socket.user.id);
                    }
                }
            }

            neededRoles = calculateNeededRoles(playersAvailable);
            currentStatusMessage = prepareStatusMessage();
            io.sockets.emit('statusUpdated', currentStatusMessage);

            // perform checks for PUG ready
        });

        socket.on('disconnect', function() {
            if (self.userSockets[socket.user.id].size === 0) {
                console.log('delete delete delte');

                lodash.forEach(playersAvailable, function(players, role) {
                    players.delete(socket.user.id);
                });

                captainsAvailable.delete(socket.user.id);

                neededRoles = calculateNeededRoles(playersAvailable);
                currentStatusMessage = prepareStatusMessage();
                io.sockets.emit('statusUpdated', currentStatusMessage);
            }
        });
    });

    app.get('/', function(req, res) {
        res.render('index', { user: req.user, roles: config.get('app.games.roles') });
    });
};
