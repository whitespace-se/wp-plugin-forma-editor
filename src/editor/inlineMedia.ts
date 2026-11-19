interface Attachment {
  toJSON(): Record<string, unknown>;
}
interface MediaFrame {
  on(event: string, callback: () => void): void;
  open(): void;
  remove(): void;
  state(): { get(key: string): { first(): Attachment } };
}
/** A dedicated frame never changes wpActiveEditor. The requesting iframe
 * retains its bookmark; only WordPress-generated image HTML crosses back. */
export function inlineMedia(): Promise<string | null> {
  const media = (
    window as unknown as {
      wp: {
        media: {
          (settings: Record<string, unknown>): MediaFrame;
          string: {
            image(
              props: Record<string, unknown>,
              attachment: Record<string, unknown>,
            ): string;
          };
        };
      };
    }
  ).wp.media;
  return new Promise((resolve) => {
    const frame = media({
      title: "Lägg till media",
      button: { text: "Infoga bild" },
      library: { type: "image" },
      multiple: false,
    });
    let result: string | null = null;
    frame.on("select", () => {
      const attachment = frame.state().get("selection").first().toJSON();
      result = media.string.image(
        {
          size: "full",
          align: "none",
          caption: "",
          link: "none",
          alt: attachment.alt,
          width: attachment.width,
          height: attachment.height,
        },
        attachment,
      );
      resolve(result);
    });
    frame.on("close", () => {
      // Core closes the select frame before emitting its selection event.
      setTimeout(() => {
        resolve(result);
        frame.remove();
      }, 0);
    });
    frame.open();
  });
}
