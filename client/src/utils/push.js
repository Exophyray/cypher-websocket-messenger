import { api } from './api';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export const Push = {
  async isSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  },

  async getPermission() {
    if (!('Notification' in window)) return 'denied';
    return Notification.permission;
  },

  async requestPermission() {
    if (!('Notification' in window)) return 'denied';
    const result = await Notification.requestPermission();
    return result;
  },

  async subscribe() {
    if (!await this.isSupported()) {
      throw new Error('Push notifications not supported');
    }

    const permission = await this.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Permission denied');
    }

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      const { key } = await api.getPushKey();
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key)
      });
    }

    await api.subscribePush(sub.toJSON());
    return sub;
  },

  async unsubscribe() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.unsubscribePush(sub.endpoint).catch(() => {});
      await sub.unsubscribe();
    }
  },

  async isSubscribed() {
    if (!await this.isSupported()) return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  }
};
