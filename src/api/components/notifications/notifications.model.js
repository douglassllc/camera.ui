'use-strict';

const moment = require('moment');
const { customAlphabet } = require('nanoid/async');
const nanoid = customAlphabet('1234567890abcdef', 10);

const { Cleartimer } = require('../../../common/cleartimer');

const { LoggerService } = require('../../../services/logger/logger.service');

const { Database } = require('../../database');

const { log } = LoggerService;

const notificationsLimit = 100;

exports.list = async (query) => {
  await Database.interfaceDB.read();

  let notifications = await Database.interfaceDB.get('notifications').reverse().value();

  if (moment(query.from, 'YYYY-MM-DD').isValid()) {
    notifications = notifications.filter((notification) => {
      let date = notification.time.split(',')[0].split('.');

      let year = date[2];
      let month = date[1];
      let day = date[0];

      date = year + '-' + month + '-' + day;

      let to = moment(query.to, 'YYYY-MM-DD').isValid() ? query.to : moment();

      let isBetween = moment(date).isBetween(query.from, to);

      return isBetween;
    });
  }

  if (query.cameras) {
    const cameras = query.cameras.split(',');
    notifications = notifications.filter((notification) => cameras.includes(notification.camera));
  }

  if (query.labels) {
    const labels = query.labels.split(',');
    notifications = notifications.filter((notification) => labels.includes(notification.label));
  }

  if (query.rooms) {
    const rooms = query.rooms.split(',');
    notifications = notifications.filter((notification) => rooms.includes(notification.room));
  }

  if (query.types) {
    const types = query.types.split(',');
    notifications = notifications.filter((notification) => types.includes(notification.recordType));
  }

  return notifications;
};

exports.listByCameraName = async (name) => {
  await Database.interfaceDB.read();

  let notifications = await Database.interfaceDB.get('notifications').reverse().value();

  if (notifications) {
    notifications = notifications.filter((not) => not.camera === name);
  }

  return notifications;
};

exports.findById = async (id) => {
  await Database.interfaceDB.read();
  return await Database.interfaceDB.get('notifications').find({ id: id }).value();
};

exports.createNotification = async (data) => {
  await Database.interfaceDB.read();

  const id = data.id || (await nanoid());
  const label = (data.label || 'no label').toString();
  const timestamp = data.timestamp || moment().unix();
  const time = moment.unix(timestamp).format('YYYY-MM-DD HH:mm:ss');

  let notification = {
    id: id,
    label: label,
    time: time,
    timestamp: timestamp,
  };

  if (data.system) {
    //every non camera (movement) notifications here
    notification = {
      ...notification,
      title: data.title,
      message: data.message,
    };

    log.notify({
      ...notification,
      title: data.title,
      message: data.message,
      subtxt: data.subtxt || false,
      mediaSource: false,
      count: true,
      isNotification: false,
    });
  } else {
    const camera = await Database.interfaceDB.get('cameras').find({ name: data.camera }).value();
    const camerasSettings = await Database.interfaceDB.get('settings').get('cameras').value();

    if (!camera) {
      throw new Error('Can not assign notification to camera!');
    }

    const cameraSetting = camerasSettings.find((cameraSetting) => cameraSetting && cameraSetting.name === camera.name);

    const cameraName = camera.name;
    const room = cameraSetting ? cameraSetting.room : 'Standard';

    const fileName =
      cameraName.replace(/\s+/g, '_') +
      '-' +
      id +
      '-' +
      timestamp +
      (data.trigger === 'motion' ? '_m' : data.trigger === 'doorbell' ? '_d' : '_c') +
      '_CUI';

    const extension = data.type === 'Video' ? 'mp4' : 'jpeg';
    const storing = data.type === 'Video' || data.type === 'Snapshot';

    notification = {
      ...notification,
      camera: cameraName,
      fileName: `${fileName}.${extension}`,
      name: fileName,
      extension: extension,
      recordStoring: storing,
      recordType: data.type,
      trigger: data.trigger,
      room: room,
    };

    Cleartimer.setNotification(id, timestamp);

    const eventTxt = data.trigger.charAt(0).toUpperCase() + data.trigger.slice(1);

    log.notify({
      ...notification,
      title: cameraName,
      message: `${eventTxt} Event - ${time}`,
      subtxt: room,
      mediaSource: storing
        ? data.type === 'Video'
          ? `/files/${fileName}@2.jpeg`
          : `/files/${fileName}.${extension}`
        : false,
      count: true,
      isNotification: true,
    });
  }

  //Check notification size, if we exceed {100} notifications, remove the latest
  const notificationList = await Database.interfaceDB.get('notifications').value();

  if (notificationList.length > notificationsLimit) {
    const diff = notificationList.length - notificationsLimit;
    await Database.interfaceDB.get('notifications').dropRight(notificationList, diff).write();
  }

  await Database.interfaceDB.get('notifications').push(notification).write();

  return notification;
};

exports.removeById = async (id) => {
  await Database.interfaceDB.read();

  Cleartimer.removeNotificationTimer(id);

  return await Database.interfaceDB
    .get('notifications')
    .remove((not) => not.id === id)
    .write();
};

exports.removeAll = async () => {
  await Database.interfaceDB.read();

  Cleartimer.stopNotifications();

  return await Database.interfaceDB
    .get('notifications')
    .remove(() => true)
    .write();
};
