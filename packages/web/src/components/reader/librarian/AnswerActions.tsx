import type { AiProviderKind } from '../../../api/types';
import { copyLabel, useCopyFlash } from '../../SettingsTabs/copyFlash';
import { useAnswerSpeech } from '../listen/answerSpeech';
import { ReaderIcon } from '../ReaderIcon';
import type { PagerEntry } from './answerVersions';
import { RegenerateMenu } from './RegenerateMenu';
import { VersionPager } from './VersionPager';

/** What the last finished answer offers beyond copy: another try, and its saved versions. */
export type AnswerControls = {
  answerModel: { provider: AiProviderKind; id: string; label: string } | undefined;
  /** Every version in pager order, the shown one included; one entry means no saved versions. */
  pager: PagerEntry[];
  onRegenerate: (model?: { provider: AiProviderKind; id: string }) => void;
  onSelectVersion: (versionId: string) => void;
};

/** Quiet buttons under a finished answer: copy its markdown, read it aloud when a voice is installed, and, on the last answer, regenerate and page through versions. */
export function AnswerActions({
  id,
  markdown,
  controls,
}: {
  id: string;
  markdown: string;
  controls?: AnswerControls | undefined;
}) {
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
        <ReaderIcon name={copied === true ? 'check' : 'copyRounded'} size={16} />
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
      {controls && (
        <RegenerateMenu answerModel={controls.answerModel} onRegenerate={controls.onRegenerate} />
      )}
      {controls && controls.pager.length > 1 && (
        <VersionPager entries={controls.pager} liveId={id} onSelect={controls.onSelectVersion} />
      )}
    </div>
  );
}
