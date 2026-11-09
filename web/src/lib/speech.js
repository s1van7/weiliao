/**
 * 语音转文字（纯前端 Web Speech API，不引入任何依赖）。
 * 使用 webkitSpeechRecognition 标准接口，不可用时由调用方隐藏入口。
 */

/**
 * 当前环境是否支持语音识别。
 * @returns {boolean}
 */
export function isSpeechRecognitionSupported() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * 创建一个语音识别器。
 * @param {{
 *   lang?: string,
 *   interimResults?: boolean,
 *   onResult?: (text: string) => void,
 *   onEnd?: () => void,
 *   onError?: (event: unknown) => void,
 * }} options
 * @returns {{start: () => void, stop: () => void, abort: () => void, supported: boolean}}
 */
export function createRecognizer({
  lang = 'zh-CN',
  interimResults = false,
  onResult,
  onEnd,
  onError,
} = {}) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) {
    return { start: () => {}, stop: () => {}, abort: () => {}, supported: false };
  }

  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.interimResults = Boolean(interimResults);
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  let ended = false;

  /**
   * 统一触发一次结束回调。
   * @returns {void}
   */
  const finish = () => {
    if (ended) return;
    ended = true;
    if (onEnd) onEnd();
  };

  recognition.onresult = (event) => {
    let text = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) text += result[0] ? result[0].transcript : '';
    }
    if (text && onResult) onResult(text);
  };

  recognition.onerror = (event) => {
    if (onError) onError(event);
    finish();
  };

  recognition.onend = () => finish();

  return {
    start: () => recognition.start(),
    stop: () => recognition.stop(),
    abort: () => recognition.abort(),
    supported: true,
  };
}

export default { isSpeechRecognitionSupported, createRecognizer };
