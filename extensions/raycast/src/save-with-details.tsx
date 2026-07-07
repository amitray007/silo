import { Action, ActionPanel, Form, showToast, Toast, useNavigation } from '@raycast/api';
import { useEffect, useState } from 'react';
import { CaptureError, captureLink } from './lib/capture-client.js';
import { isHttpUrl, resolveUrl } from './lib/resolve-url.js';

/**
 * The SECONDARY command (brief: "note/tags as secondary... not the default
 * path"). A form: URL prefilled from the frontmost browser tab / clipboard
 * (same resolution as the instant command), plus optional note + tags.
 */
export default function Command() {
  const { pop } = useNavigation();
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [isLoadingUrl, setIsLoadingUrl] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      const resolved = await resolveUrl();
      if (resolved) setUrl(resolved.url);
      setIsLoadingUrl(false);
    })();
  }, []);

  async function handleSubmit(): Promise<void> {
    if (!isHttpUrl(url.trim())) {
      await showToast({ style: Toast.Style.Failure, title: 'Enter a valid http(s) URL' });
      return;
    }

    setIsSubmitting(true);
    try {
      const tagList = tags
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

      const { deduped } = await captureLink({
        url: url.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(tagList.length > 0 ? { tags: tagList } : {}),
      });

      await showToast({
        style: Toast.Style.Success,
        title: deduped ? 'Already in silo (updated)' : 'Saved to silo',
      });
      pop();
    } catch (error) {
      const message = error instanceof CaptureError ? error.message : 'Could not save to silo';
      await showToast({ style: Toast.Style.Failure, title: message });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      isLoading={isLoadingUrl || isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save to Silo" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="url"
        title="URL"
        placeholder="https://example.com"
        value={url}
        onChange={setUrl}
      />
      <Form.TextArea
        id="note"
        title="Note"
        placeholder="Optional note"
        value={note}
        onChange={setNote}
      />
      <Form.TextField
        id="tags"
        title="Tags"
        placeholder="comma, separated, tags"
        value={tags}
        onChange={setTags}
      />
    </Form>
  );
}
