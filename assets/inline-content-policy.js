(() => {
  const attributes = {
    p: [],
    br: [],
    h2: [],
    h3: [],
    h4: [],
    h5: [],
    h6: [],
    strong: [],
    em: [],
    b: [],
    i: [],
    ul: [],
    ol: ["start", "reversed", "type"],
    li: ["value"],
    blockquote: ["cite"],
    hr: [],
    a: ["href", "target", "rel", "title"],
    img: ["src", "alt", "width", "height", "class", "title"],
  };
  const parse = (source) => {
    const template = document.createElement("template");
    template.innerHTML = source;
    return template.content;
  };
  const safe = (source) => {
    if (
      typeof source !== "string" ||
      /^\s*https?:\/\/\S+\s*$/m.test(source) ||
      /\[\/?[a-z][\w-]*(?:\s|\]|\/)/i.test(source) ||
      /<!DOCTYPE|<\?/i.test(source)
    )
      return false;
    const root = parse(source);
    const walk = (node) => {
      if (node.nodeType === 3) return true;
      if (node.nodeType === 8) return node.data === "more";
      if (node.nodeType !== 1) return false;
      const tag = node.localName;
      if (!Object.hasOwn(attributes, tag)) return false;
      for (const { name, value } of node.attributes) {
        if (!attributes[tag].includes(name)) return false;
        if (
          ["href", "src", "cite"].includes(name) &&
          /^(?!https?:|mailto:|tel:)[a-z][a-z\d+.-]*:/i.test(
            value.trim().replace(/[\u0000-\u0020]/g, ""),
          )
        )
          return false;
        if (
          name === "class" &&
          !value
            .split(/\s+/)
            .every((part) =>
              /^(?:align(?:none|left|right|center)|size-[\w-]+|wp-image-\d+)$/.test(
                part,
              ),
            )
        )
          return false;
      }
      return [...node.childNodes].every(walk);
    };
    return [...root.childNodes].every(walk);
  };
  // Compare meaningful structure/attributes, not quote style, entities or
  // indentation. The untouched raw string remains authoritative for no-op.
  const signature = (source) => {
    source = source.replace(/<p>\s*(<!--more-->)\s*<\/p>/g, "$1");
    const visit = (node) => {
      if (node.nodeType === 3) {
        const text = node.data.replace(/[\t\r\n ]+/g, " ");
        if (
          !text.trim() &&
          (!node.previousSibling ||
            !node.nextSibling ||
            node.previousSibling.nodeType === 8 ||
            node.nextSibling.nodeType === 8 ||
            node.parentNode.nodeType === 11 ||
            ["ul", "ol", "blockquote"].includes(node.parentNode.localName))
        )
          return null;
        return ["text", text];
      }
      if (node.nodeType === 8) return ["comment", node.data];
      return [
        node.localName,
        [...node.attributes].map((attr) => [attr.name, attr.value]).sort(),
        [...node.childNodes].map(visit).filter(Boolean),
      ];
    };
    return JSON.stringify(
      [...parse(source).childNodes].map(visit).filter(Boolean),
    );
  };
  window.formaContentPolicy = { safe, signature };
})();
