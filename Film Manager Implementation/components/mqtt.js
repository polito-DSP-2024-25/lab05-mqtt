'use strict'

var mqtt = require('mqtt');
var Reviews = require('../service/ReviewsService');
var MQTTFilmMessage = require('./mqtt_film_message.js');

var host = 'ws://127.0.0.1:8080';
var clientId = 'mqttjs_' + Math.random().toString(16).substr(2, 8);
var options = {
  keepalive: 30,
  clientId: clientId,
  clean: true,
  reconnectPeriod: 60000,
  connectTimeout: 30*1000,
  will: {
    topic: 'WillMsg',
    payload: 'Connection Closed abnormally..!',
    qos: 0,
    retain: false
  },
  rejectUnauthorized: false
};
var mqtt_connection = mqtt.connect(host, options);

mqtt_connection.on('error', function (err) {
  console.log(err)
  mqtt_connection.end()
})

//When the connection with the MQTT broker is established, a retained message for each public film is sent
mqtt_connection.on('connect', function () {
  console.log('client connected:' + clientId)

  Reviews.getFilmSelections().then(function (selections) {
    selections.forEach(function(selection){
      var status = (selection.userId) ? "active" : "inactive";
      var message = new MQTTFilmMessage(status, selection.userId, selection.userName);
      mqtt_connection.publish(String(selection.filmId), JSON.stringify(message), { qos: 0, retain: true });
    });
  }) .catch(function (error) {
    mqtt_connection.end();
  });
})

mqtt_connection.on('close', function () {
  console.log(clientId + ' disconnected');
})

module.exports.publishFilmMessage = function publishFilmMessage(filmId, message) {
    mqtt_connection.publish(String(filmId), JSON.stringify(message), { qos: 0, retain: true })
};