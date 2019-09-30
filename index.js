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
const MQTT_TOPIC_TIMER = 'timer';

const MQTT_TOPIC_RELAY_1 = `${MQTT_TOPIC}/${NODE_NAME_RELAY_1}`;
const MQTT_TOPIC_RELAY_2 = `${MQTT_TOPIC}/${NODE_NAME_RELAY_2}`;
const MQTT_TOPIC_SET_RELAY_1 = `${MQTT_TOPIC_RELAY_1}/${MQTT_TOPIC_SET}`;
const MQTT_TOPIC_SET_RELAY_2 = `${MQTT_TOPIC_RELAY_2}/${MQTT_TOPIC_SET}`;

const MQTT_VALUE_ON = 'ON';
const MQTT_VALUE_OFF = 'OFF';

// Interval at which to send the current relay status back
const MQTT_STATUS_UPDATE_INTERVAL_MS = 5000;

// Maximum water runtime before it auto shuts off
const MAXIMUM_RUNTIME_M = 5;

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

let shutoffTime = null;

const statusInterval = setInterval(runStatusLoop, MQTT_STATUS_UPDATE_INTERVAL_MS); 
let safetyShutoffTimeout = null;

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

function startSafetyTimer() {
    LOGGER.info(`Starting safety timer for ${MAXIMUM_RUNTIME_M} min`);

    shutoffTime = moment().add(MAXIMUM_RUNTIME_M, 'minute');
}

function safetyShutoff() {
    if (isRelayOn()) {
        LOGGER.warn(`Performing safety shutoff after ${MAXIMUM_RUNTIME_M} min `);
        switchRelay(MQTT_TOPIC_RELAY_1, PORT_1, NODE_NAME_RELAY_1, 'OFF');
        switchRelay(MQTT_TOPIC_RELAY_2, PORT_2, NODE_NAME_RELAY_2, 'OFF');
    }

    shutoffTime = null;
}

//function sendRelayStatus(mqttTopic, port) {
    //let relayValue = port.readSync() === 0 ? MQTT_VALUE_OFF : MQTT_VALUE_ON;    
    //client.publish(mqttTopic, relayValue)
//}

function isRelayOn() {
    return PORT_1.readSync() !== 0 || PORT_2.readSync() !== 0;
}

function runStatusLoop() {
    if(shutoffTime) {
       //LOGGER.debug(moment().isAfter(shutoffTime));
       if (moment().isAfter(shutoffTime)) {
            safetyShutoff(); 
       }
    }

    sendStatus();
}

function sendStatus() {
    //sendRelayStatus(MQTT_TOPIC_RELAY_1, PORT_1);
    //sendRelayStatus(MQTT_TOPIC_RELAY_2, PORT_2);

    let relay1Value = PORT_1.readSync() === 0 ? MQTT_VALUE_OFF : MQTT_VALUE_ON;    
    let relay2Value = PORT_2.readSync() === 0 ? MQTT_VALUE_OFF : MQTT_VALUE_ON;    

    let timeRemaining = shutoffTime ? moment.duration(shutoffTime.diff(moment())).asSeconds() : 0;

    let payload = {};
    payload['relay_1'] = relay1Value;
    payload['relay_2'] = relay2Value;
    payload['timestamp'] = moment().format();
    payload['timer'] = timeRemaining > 0 ? timeRemaining : 0;

    const payloadString = JSON.stringify(payload);
    LOGGER.debug('Sending status: ' + payloadString);

    client.publish(MQTT_TOPIC, payloadString);
}

function switchRelay(mqttTopic, port, name, message) { 
     LOGGER.debug(`Switching relay ${name} to value ${message}`);

     if (message == MQTT_VALUE_ON) {
        port.writeSync(1); 
        startSafetyTimer();
     } else if (message == MQTT_VALUE_OFF) {
        port.writeSync(0); 
     } else {
        LOGGER.error(`Unknown MQTT value for ${name}: ${message}`);
     }

    sendStatus();
}

