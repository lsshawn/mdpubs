import katex from 'katex';
import type { KatexOptions } from 'katex';
import type { MarkedExtension, TokenizerAndRendererExtension, Tokens } from 'marked';

/**
 * LaTeX math for marked, adapted from marked-katex-extension (MIT).
 *
 * Upstream's "standard" mode only recognises inline math when the opening $
 * is preceded by a space and the closing $ is followed by whitespace or a
 * small punctuation set — silently skipping common forms like `($x$)`,
 * `$x$;` and `$S$'s`, and then mis-tokenizing across to the next `$`. Its
 * "nonStandard" mode matches any `$...$`, which would turn dollar prices in
 * existing notes ("between $5 and $10") into math.
 *
 * This version widens both delimiter boundaries (brackets, quotes,
 * semicolons, apostrophes, dashes) but still refuses a closing $ that is
 * immediately followed by an alphanumeric, so price pairs stay literal text.
 */

const inlineRule =
	/^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$]))\1(?=[\s?!.,:;'")\]}\-–—*_？！。，：]|$)/;
const blockRule = /^(\${1,2})\n((?:\\[^]|[^\\])+?)\n\1(?:\n|$)/;

// Characters allowed immediately before an opening $ (besides start-of-text).
const openerBoundary = /[\s([{'"*_\-–—]/;

interface MathToken extends Tokens.Generic {
	type: 'inlineKatex' | 'blockKatex';
	raw: string;
	text: string;
	displayMode: boolean;
}

function createRenderer(options: KatexOptions, newlineAfter: boolean) {
	return (token: Tokens.Generic): string =>
		katex.renderToString((token as MathToken).text, {
			...options,
			displayMode: (token as MathToken).displayMode
		}) + (newlineAfter ? '\n' : '');
}

function inlineKatex(options: KatexOptions): TokenizerAndRendererExtension {
	return {
		name: 'inlineKatex',
		level: 'inline',
		start(src: string) {
			let index: number;
			let indexSrc = src;

			while (indexSrc) {
				index = indexSrc.indexOf('$');
				if (index === -1) {
					return;
				}
				const boundaryOk = index === 0 || openerBoundary.test(indexSrc.charAt(index - 1));
				if (boundaryOk && inlineRule.test(indexSrc.substring(index))) {
					return src.length - indexSrc.length + index;
				}

				indexSrc = indexSrc.substring(index + 1).replace(/^\$+/, '');
			}
		},
		tokenizer(src: string): MathToken | undefined {
			const match = src.match(inlineRule);
			if (match) {
				return {
					type: 'inlineKatex',
					raw: match[0],
					text: match[2].trim(),
					displayMode: match[1].length === 2
				};
			}
		},
		renderer: createRenderer(options, false)
	};
}

function blockKatex(options: KatexOptions): TokenizerAndRendererExtension {
	return {
		name: 'blockKatex',
		level: 'block',
		tokenizer(src: string): MathToken | undefined {
			const match = src.match(blockRule);
			if (match) {
				return {
					type: 'blockKatex',
					raw: match[0],
					text: match[2].trim(),
					displayMode: match[1].length === 2
				};
			}
		},
		renderer: createRenderer(options, true)
	};
}

export default function markedMath(options: KatexOptions = {}): MarkedExtension {
	return {
		extensions: [inlineKatex(options), blockKatex(options)]
	};
}
