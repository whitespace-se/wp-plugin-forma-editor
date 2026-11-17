import React, { useLayoutEffect, useRef, useState } from "react";

interface AcfWindow {
  acf: {
    doAction: (action: string, element: unknown) => void;
    getField: (key: string) =>
      | {
          setValue: (value: string) => void;
          showError: (message: string) => void;
          removeError: () => void;
        }
      | false
      | undefined;
    unload: {
      active: boolean;
      reset: () => void;
      disable: () => void;
      enable: () => void;
    };
  };
  jQuery: (element: Element) => {
    on: (events: string, callback: () => void) => void;
    off: (events: string, callback: () => void) => void;
  };
}

/** ACF owns this DOM subtree; React owns only its lifetime and lock boundary. */
export function NavigationFields({
  activeGroup,
  markup,
  initialValues,
  disabled,
  label,
  errorLabel,
  errors,
  onChange,
  onLeave,
}: {
  activeGroup?: string | null;
  markup: string;
  initialValues: Record<string, string>;
  disabled: boolean;
  label: string;
  errorLabel: string;
  errors?: { input: string; message: string }[];
  onChange: (values: Record<string, string>) => void;
  onLeave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const callbacks = useRef({ onChange, onLeave });
  callbacks.current = { onChange, onLeave };
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const node = host.current!;
    const acf = (window as unknown as AcfWindow).acf;
    const jquery = (window as unknown as AcfWindow).jQuery;
    if (!acf || !jquery) {
      setFailed(true);
      return;
    }
    node.innerHTML = markup;
    for (const input of node.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("input[name], select[name]")) {
      const key = /^acf\[([^\]]+)\]$/.exec(input.name)?.[1];
      if (!key || !(key in initialValues)) continue;
      if (input instanceof HTMLInputElement && input.type === "checkbox")
        input.checked = initialValues[key] === "1";
      else if (input.type !== "hidden") input.value = initialValues[key];
    }
    const element = jquery(node);
    acf.doAction("append", element);
    // The PHP markup carries the saved switch's visual state. Setting checked
    // before append lets conditional logic see the resumed values, but ACF's
    // true_false initializer only measures the switch; its setter syncs the UI.
    for (const [key, value] of Object.entries(initialValues)) {
      const field = acf.getField(key);
      if (field) field.setValue(value);
    }
    // Forma owns the shared autosave/leave warning, including ACF changes.
    const unloadActive = acf.unload.active;
    acf.unload.reset();
    acf.unload.disable();
    let values = { ...initialValues };
    const change = () => {
      // Native successful-controls semantics preserve ACF's hidden 0 + checkbox
      // 1 pair. Keep fields disabled by conditional logic at their last value.
      const next = { ...values };
      for (const [name, value] of new FormData(form.current!)) {
        const key = /^acf\[([^\]]+)\]$/.exec(name)?.[1];
        if (key && key in initialValues && typeof value === "string")
          next[key] = value;
      }
      values = next;
      callbacks.current.onChange(next);
    };
    element.on("input change", change);
    return () => {
      element.off("input change", change);
      acf.doAction("remove", element);
      if (unloadActive) acf.unload.enable();
      node.replaceChildren();
    };
  }, []);
  useLayoutEffect(() => {
    // Keep ACF instances and values alive when navigating between groups.
    const groups = host.current?.querySelectorAll<HTMLElement>(
      ".forma-editor__acf-group",
    );
    groups?.forEach((group, index) => {
      group.hidden = activeGroup != null && String(index) !== activeGroup;
      group.classList.add("forma-editor__slide-in");
    });
  });
  useLayoutEffect(() => {
    const acf = (window as unknown as AcfWindow).acf;
    if (!acf) return;
    for (const key of Object.keys(initialValues)) {
      const field = acf.getField(key);
      if (field) field.removeError();
    }
    for (const error of errors ?? []) {
      const key = /^acf\[([^\]]+)\]$/.exec(error.input)?.[1];
      if (key && key in initialValues) {
        const field = acf.getField(key);
        if (field) field.showError(error.message);
      }
    }
  }, [errors]);
  return (
    <form
      ref={form}
      className="forma-editor__navigation"
      onSubmit={(event) => {
        event.preventDefault();
        callbacks.current.onLeave();
      }}
      onBlur={() => callbacks.current.onLeave()}
    >
      <fieldset disabled={disabled || failed}>
        <legend className="screen-reader-text">{label}</legend>
        {failed && <p role="alert">{errorLabel}</p>}
        <div ref={host} />
      </fieldset>
    </form>
  );
}
