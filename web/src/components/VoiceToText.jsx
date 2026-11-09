/**
 * 语音转文字按钮（语音输入）：
 *   - 当前环境不支持时直接隐藏；
 *   - 首次开启展示一次性提示（实验性功能）；
 *   - 点击后开始聆听，识别到最终文本通过 onResult 回传。
 */
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { useUI } from '../store/useUI';
import { createRecognizer, isSpeechRecognitionSupported } from '../lib/speech';

/**
 * @param {{
 *   onResult: (text: string) => void,
 * }} props
 * @returns {JSX.Element|null}
 */
export default function VoiceToText({ onResult }) {
  const showToast = useUI((state) => state.showToast);
  const [listening, setListening] = useState(false);
  const recognizerRef = useRef(null);
  const warnedRef = useRef(false);

  useEffect(
    () => () => {
      if (recognizerRef.current) recognizerRef.current.abort();
    },
    [],
  );

  if (!isSpeechRecognitionSupported()) return null;

  /**
   * 开启 / 停止语音识别。
   * @returns {void}
   */
  const handleToggle = () => {
    if (listening) {
      if (recognizerRef.current) recognizerRef.current.stop();
      return;
    }
    if (!warnedRef.current) {
      warnedRef.current = true;
      showToast('语音转文字为实验功能，请在安静环境下使用');
    }
    const recognizer = createRecognizer({
      onResult: (text) => {
        if (onResult) onResult(text);
      },
      onEnd: () => setListening(false),
      onError: () => setListening(false),
    });
    recognizerRef.current = recognizer;
    setListening(true);
    recognizer.start();
  };

  return (
    <button
      type="button"
      aria-label="语音转文字"
      onClick={handleToggle}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-black/5 ${
        listening ? 'text-[#07C160]' : 'text-[#333]'
      }`}
    >
      <Icon name="micText" size={24} />
    </button>
  );
}
