import DOMPurify from 'dompurify';

type Props = {
  contentHtml: string;
  className?: string;
};

export default function CorrectionReasonPreview({
  contentHtml,
  className = '',
}: Props) {
  const safeHtml = DOMPurify.sanitize(contentHtml, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['style'],
  });

  return (
    <div
      className={`scr-preview ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}