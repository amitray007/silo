import type { MermaidConfig } from 'mermaid';

/** Resolve CSS colors to rgb: Mermaid's color parser cannot read oklch or CSS variables. */
function palette(root: HTMLElement): Record<string, string> {
  const probe = document.createElement('span');
  root.append(probe);
  const colors: Record<string, string> = {};
  const canvas = document.createElement('canvas').getContext('2d');
  for (const token of ['ink', 'bg', 'bg2', 'mut', 'line-2']) {
    probe.style.color = `var(--${token})`;
    if (canvas) {
      canvas.fillStyle = getComputedStyle(probe).color;
      const data = canvas.getImageData(0, 0, 1, 1);
      canvas.fillRect(0, 0, 1, 1);
      const pixel = canvas.getImageData(0, 0, 1, 1).data;
      colors[token] = `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
      canvas.putImageData(data, 0, 0);
    } else colors[token] = getComputedStyle(probe).color;
  }
  probe.remove();
  return colors;
}

/** Mermaid settings shared by the reader and the chat: strict, no HTML labels, colours from the Oat tokens. */
export function mermaidConfig(root: HTMLElement): MermaidConfig {
  const colors = palette(root);
  const fontFamily = getComputedStyle(root).fontFamily;
  return {
    securityLevel: 'strict',
    startOnLoad: false,
    secure: [
      'securityLevel',
      'startOnLoad',
      'htmlLabels',
      'flowchart',
      'theme',
      'themeVariables',
      'themeCSS',
      'fontFamily',
      'maxTextSize',
      'suppressErrorRendering',
    ],
    htmlLabels: false,
    theme: 'base',
    fontFamily,
    suppressErrorRendering: true,
    flowchart: { htmlLabels: false },
    themeVariables: {
      background: colors.bg,
      primaryColor: colors.bg2,
      primaryTextColor: colors.ink,
      primaryBorderColor: colors['line-2'],
      lineColor: colors.mut,
      secondaryColor: colors.bg2,
      tertiaryColor: colors.bg,
      textColor: colors.ink,
      nodeTextColor: colors.ink,
      fontFamily,
      // Flat nodes: the default theme adds a drop shadow and gradient borders.
      dropShadow: 'none',
      useGradient: false,
    },
  };
}
