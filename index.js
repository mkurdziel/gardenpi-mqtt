const _ = require('lodash');
const moment = require('moment');
const winston = require('winston');
const { combine, timestamp, label, printf } = winston.format;
const mqtt = require('mqtt')

const Gpio = require('onoff').Gpio; //include onoff to interact with the GPIO

const NODE_NAME_RELAY_1 = 'relay_1';
const NODE_NAME_RELAY_2 = 'relay_2';

const GPIO_NUM_RELAY_1 = 20;
const GPIO_NUM_RELAY_2 = 21;

const MQTT_HOST = process.env.MQTT_HOST || 'mqtt://192.168.1.2';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'node/gardenpi';
const MQTT_TOPIC_SET = 'set';
const MQTT_TOPIC_CHECKIN = 'checkin';

const MQTT_TOPIC_RELAY_1 = `${MQTT_TOPIC}/${NODE_NAME_RELAY_1}`;
const MQTT_TOPIC_RELAY_2 = `${MQTT_TOPIC}/${NODE_NAME_RELAY_2}`;
const MQTT_TOPIC_SET_RELAY_1 = `${MQTT_TOPIC_RELAY_1}/${MQTT_TOPIC_SET}`;
const MQTT_TOPIC_SET_RELAY_2 = `${MQTT_TOPIC_RELAY_2}/${MQTT_TOPIC_SET}`;

const MQTT_VALUE_ON = 'ON';
const MQTT_VALUE_OFF = 'OFF';

// Period at which to update the checkin time
const CHECKIN_PERIOD_MS = 5000;

// Interval at which to send the current relay status back
const MQTT_STATUS_UPDATE_INTERVAL_MS = 5000;

const LOG_FORMAT = printf(({ level, message, label, timestamp }) => {
  return `${timestamp} [${level}]: ${message}`;
});

const client = mqtt.connect(MQTT_HOST);
const LOGGER = winston.createLogger(
{
    level: 'debug',
    format: combine(
        winston.format.colorize(),
        timestamp(),
        LOG_FORMAT
  ),
  transports: [
    new winston.transports.Console()
  ]
});

// Open the relay ports on the pi GPIO
PORT_1 = new Gpio(GPIO_NUM_RELAY_1, 'out');
PORT_2 = new Gpio(GPIO_NUM_RELAY_2, 'out');

const statusInterval = setInterval(sendStatus, MQTT_STATUS_UPDATE_INTERVAL_MS); 
const checkinInterval = setInterval(sendCheckin, CHECKIN_PERIOD_MS); 

client.on('connect', () => {
	LOGGER.info(`Connected to MQTT host: ` + MQTT_HOST);
	LOGGER.info(`Subscribing to : ` + MQTT_TOPIC_SET_RELAY_1);
	LOGGER.info(`Subscribing to : ` + MQTT_TOPIC_SET_RELAY_2);
    client.subscribe(MQTT_TOPIC_SET_RELAY_1);
    client.subscribe(MQTT_TOPIC_SET_RELAY_2);
})

client.on('message', (topic, message) => {
    if(topic === MQTT_TOPIC_SET_RELAY_1) {
        switchRelay(MQTT_TOPIC_RELAY_1, PORT_1, NODE_NAME_RELAY_1, message);
    } else if(topic === MQTT_TOPIC_SET_RELAY_2) {
        switchRelay(MQTT_TOPIC_RELAY_2, PORT_2, NODE_NAME_RELAY_2, message);
    } else {
        LOGGER.error(`Unknown topic received: ${topic}`);
    }
})

function sendRelayStatus(mqttTopic, port) {
    let relayValue = port.readSync() === 0 ? MQTT_VALUE_OFF : MQTT_VALUE_ON;    
    client.publish(mqttTopic, relayValue)
}

function sendStatus() {
    sendRelayStatus(MQTT_TOPIC_RELAY_1, PORT_1);
    sendRelayStatus(MQTT_TOPIC_RELAY_2, PORT_2);
}

function switchRelay(mqttTopic, port, name, message) { 
     LOGGER.debug(`Switching relay ${name} to value ${message}`);

     if (message == MQTT_VALUE_ON) {
        port.writeSync(1); 
     } else if (message == MQTT_VALUE_OFF) {
        port.writeSync(0); 
     } else {
        LOGGER.error(`Unknown MQTT value for ${name}: ${message}`);
     }

    sendRelayStatus(mqttTopic, port);
}

function sendCheckin() {
    LOGGER.debug(`Sending checkin: ${moment().format()}`);
    client.publish(`${MQTT_TOPIC}/${MQTT_TOPIC_CHECKIN}`, moment().format());
}

