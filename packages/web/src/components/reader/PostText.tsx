import { tokenizePostText } from '../../lib/postText';

/** An X post's text with its links, handles and hashtags as real links. Line breaks stay in the text. */
export function PostText({ text }: { text: string }) {
  return (
    <>
      {tokenizePostText(text).map((token, index) =>
        token.type === 'text' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens come from one immutable string
          <span key={index}>{token.value}</span>
        ) : (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: tokens come from one immutable string
            key={index}
            className="silo-post-link"
            href={token.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {token.value}
          </a>
        ),
      )}
    </>
  );
}
