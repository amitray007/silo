import { copyLabel, useCopyFlash } from '../../SettingsTabs/copyFlash';
import { useAnswerSpeech } from '../listen/answerSpeech';
import { ReaderIcon } from '../ReaderIcon';

/** Quiet buttons under a finished answer: copy its markdown, and read it aloud when a voice is installed. */
export function AnswerActions({ id, markdown }: { id: string; markdown: string }) {
  const { copied, copyText } = useCopyFlash();
  const speech = useAnswerSpeech(id, markdown);
  const copyName = copyLabel(copied, 'Copy answer');
  const speechName = speech.phase === 'idle' ? 'Read aloud' : 'Stop reading';
  return (
    <div className="silo-chat-actions">
      <button
        type="button"
        className="silo-reader-iconbtn"
        aria-label={copyName}
        title={copyName}
        onClick={() => copyText(markdown)}
      >
        <ReaderIcon name={copied === true ? 'check' : 'copy'} size={16} />
      </button>
      {speech.available && (
        <button
          type="button"
          className="silo-reader-iconbtn"
          aria-label={speechName}
          aria-pressed={speech.phase !== 'idle'}
          title={speechName}
          onClick={speech.toggle}
        >
          <ReaderIcon name={speech.phase === 'idle' ? 'speaker' : 'stop'} size={16} />
        </button>
      )}
    </div>
  );
}
