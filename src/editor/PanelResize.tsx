import React, { useRef } from "react";

export function PanelResize({
  width,
  label,
  onChange,
  onDragging,
}: {
  width: number;
  label: string;
  onChange: (width: number) => void;
  onDragging: (dragging: boolean) => void;
}) {
  const drag = useRef<{ pointer: number; x: number; width: number }>();
  const resize = (next: number) => onChange(Math.max(320, Math.min(800, next)));
  const end = () => {
    drag.current = undefined;
    onDragging(false);
  };
  return (
    <div
      className="forma-editor__resize"
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-controls="forma-panel"
      aria-valuemin={320}
      aria-valuemax={800}
      aria-valuenow={width}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointer: event.pointerId,
          x: event.clientX,
          width: document.getElementById("forma-panel")!.getBoundingClientRect()
            .width,
        };
        onDragging(true);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        resize(drag.current.width + drag.current.x - event.clientX);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        end();
      }}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={(event) => {
        const next = {
          ArrowLeft: width + 20,
          ArrowRight: width - 20,
          Home: 320,
          End: 800,
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        resize(next);
      }}
    />
  );
}
