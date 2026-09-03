import firebaseMessaging from "../config/firebaseAdmin.js";

export const sendPushNotification = async ({
  token,
  title,
  body,
  data = {},
}) => {
  try {
    if (!token) {
      throw new Error('FCM token is required');
    }

    const safeData = {};

    Object.keys(data).forEach((key) => {
      safeData[key] = String(data[key]);
    });

    const notificationType = String(safeData.type || '').toUpperCase();
    const isCallNotification =
      notificationType.includes('CALL') && Boolean(safeData.callId);

    const message = {
      token,
      ...(isCallNotification
        ? {
            data: {
              ...safeData,
              title: String(title || 'Incoming call'),
              body: String(body || 'Incoming call'),
            },
          }
        : {
            notification: { title, body },
            data: safeData,
          }),
      android: {
        priority: 'high',
        ...(isCallNotification
          ? {}
          : { notification: { sound: 'default' } }),
      },
    };

    const response = await firebaseMessaging.send(message);

    console.log('✅ Push notification sent successfully:');
    console.log(response);

    return response;
  } catch (error) {
    console.error('❌ Push notification error:', error);
    throw error;
  }
};

