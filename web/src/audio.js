/**
 * 提示音：WebAudio 合成多种提示音效，无需任何音频资源文件。
 * 音效选择持久化在 localStorage（wx.notification_sound），取值 default/crisp/water/xylo/silent。
 * 浏览器自动播放策略要求首次用户手势后 unlock。
 */
import { NOTIFICATION_SOUND_KEY, NOTIFICATION_SOUNDS, SOUND_KEY } from './config';

/** 默认提示音效 */
const DEFAULT_SOUND = 'default';

/** @type {AudioContext|null} */
let ctx = null;

/**
 * 惰性创建 AudioContext。
 * @returns {AudioContext|null}
 */
function getContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch (err) {
      console.warn('[audio] AudioContext unavailable:', err);
      return null;
    }
  }
  return ctx;
}

/**
 * 在首次用户手势时调用，解锁音频播放权限。
 * @returns {void}
 */
export function unlockAudio() {
  const context = getContext();
  if (!context) return;
  if (context.state === 'suspended') {
    context.resume().catch(() => {});
  }
}

/**
 * 提示音是否开启（默认开启，历史开关兼容保留）。
 * @returns {boolean}
 */
export function isSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * 设置提示音开关并持久化（历史兼容保留）。
 * @param {boolean} enabled
 * @returns {void}
 */
export function setSoundEnabled(enabled) {
  try {
    localStorage.setItem(SOUND_KEY, enabled ? 'on' : 'off');
  } catch {
    /* 隐私模式下忽略 */
  }
}

/**
 * 读取当前提示音音效。
 * @returns {string} default/crisp/water/xylo/silent
 */
export function getNotificationSound() {
  try {
    const value = localStorage.getItem(NOTIFICATION_SOUND_KEY);
    return value && Object.prototype.hasOwnProperty.call(NOTIFICATION_SOUNDS, value) ? value : DEFAULT_SOUND;
  } catch {
    return DEFAULT_SOUND;
  }
}

/**
 * 设置当前提示音音效并持久化。
 * @param {string} name default/crisp/water/xylo/silent
 * @returns {void}
 */
export function setNotificationSound(name) {
  const value = Object.prototype.hasOwnProperty.call(NOTIFICATION_SOUNDS, name) ? name : DEFAULT_SOUND;
  try {
    localStorage.setItem(NOTIFICATION_SOUND_KEY, value);
  } catch {
    /* 隐私模式下忽略 */
  }
}

/**
 * 播放一个带淡入淡出的音（可指定波形）。
 * @param {AudioContext} context
 * @param {number} frequency 频率（Hz）
 * @param {number} startAt 起始时间（AudioContext 时间轴）
 * @param {number} duration 持续时长（秒）
 * @param {number} volume 峰值音量
 * @param {OscillatorType} [type] 波形，默认 sine
 * @returns {void}
 */
function tone(context, frequency, startAt, duration, volume, type = 'sine') {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(volume, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

/**
 * 播放经典「叮—咚」双音。
 * @param {AudioContext} context
 * @param {number} base 起始时间
 * @returns {void}
 */
function playDefault(context, base) {
  tone(context, 987.77, base, 0.16, 0.09); // B5
  tone(context, 659.25, base + 0.12, 0.26, 0.08); // E5
}

/**
 * 播放「清脆」短促双音。
 * @param {AudioContext} context
 * @param {number} base 起始时间
 * @returns {void}
 */
function playCrisp(context, base) {
  tone(context, 1567.98, base, 0.09, 0.08, 'triangle'); // G6
  tone(context, 2093.0, base + 0.09, 0.14, 0.07, 'triangle'); // C7
}

/**
 * 播放「水滴」下坠三连音。
 * @param {AudioContext} context
 * @param {number} base 起始时间
 * @returns {void}
 */
function playWater(context, base) {
  tone(context, 1318.51, base, 0.1, 0.08); // E6
  tone(context, 1046.5, base + 0.1, 0.1, 0.07); // C6
  tone(context, 783.99, base + 0.2, 0.18, 0.06); // G5
}

/**
 * 播放「木琴」轻快双音。
 * @param {AudioContext} context
 * @param {number} base 起始时间
 * @returns {void}
 */
function playXylo(context, base) {
  tone(context, 659.25, base, 0.12, 0.08, 'triangle'); // E5
  tone(context, 880.0, base + 0.11, 0.16, 0.07, 'triangle'); // A5
}

/**
 * 按指定音效播放一段提示音（用于试听，静音音效不发声）。
 * @param {string} kind default/crisp/water/xylo/silent
 * @returns {void}
 */
export function playNotificationSound(kind) {
  const value = Object.prototype.hasOwnProperty.call(NOTIFICATION_SOUNDS, kind) ? kind : DEFAULT_SOUND;
  if (value === 'silent') return;
  const context = getContext();
  if (!context) return;
  if (context.state === 'suspended') {
    context.resume().catch(() => {});
  }
  const base = context.currentTime + 0.01;

  if (value === 'crisp') playCrisp(context, base);
  else if (value === 'water') playWater(context, base);
  else if (value === 'xylo') playXylo(context, base);
  else playDefault(context, base);
}

/**
 * 播放新消息提示音（依据当前音效选择，并尊重声音总开关）。
 * @returns {void}
 */
export function playMessageSound() {
  const kind = getNotificationSound();
  if (kind === 'silent') return;
  if (!isSoundEnabled()) return;
  playNotificationSound(kind);
}

export default {
  unlockAudio,
  playMessageSound,
  playNotificationSound,
  isSoundEnabled,
  setSoundEnabled,
  getNotificationSound,
  setNotificationSound,
};
