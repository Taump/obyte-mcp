export function textResult(text: string): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text }]
  };
}
