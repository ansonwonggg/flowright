import { splitTag, toneOf } from '../lib/flowChart.ts';

/** Props of {@link FnTitle}. */
export type FnTitleProps = {
  /** A function title, usually with a leading portal tag such as `[Web] Create ER User`. */
  title: string;
};

/**
 * A function title with its leading `[tag]` drawn as a coloured chip. The brackets stay in the text
 * (only hidden on screen), so the element's text and a copy-paste still read `[Web] Create ER User`.
 * A title without a tag renders as plain text.
 */
export const FnTitle = ({ title }: FnTitleProps) => {
  const { tag, name } = splitTag(title);
  if (!tag) return <>{title}</>;
  return (
    <>
      <span className={`tag tone-${toneOf(tag)}`}>
        <span className="br">[</span>
        {tag}
        <span className="br">]</span>
      </span>{' '}
      {name}
    </>
  );
};
