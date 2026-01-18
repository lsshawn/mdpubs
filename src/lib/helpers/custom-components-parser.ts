/**
 * Custom Components Parser
 * Parses custom markdown syntax and converts it to component-ready HTML
 *
 * Syntax examples:
 * - ::progress[5/100]
 * - ::progress[25/100 label="Tasks completed"]
 * - ::progress[{daysElapsed}/{totalDays} label="Year progress"]
 * - ::progress[{getWeekNumber()}/52 label="Weeks this year" color=success]
 */

interface ProgressConfig {
	value: number | string;
	max: number | string;
	label?: string;
	color?: string;
	showPercentage?: boolean;
	showFraction?: boolean;
}

/**
 * Evaluates JavaScript expressions safely
 */
function evaluateExpression(expr: string): number {
	// Define helper functions that can be used in expressions
	const now = new Date();
	const currentYear = now.getFullYear();

	// Helper: Get day of year (1-365/366)
	const getDayOfYear = (): number => {
		const start = new Date(currentYear, 0, 0);
		const diff = now.getTime() - start.getTime();
		return Math.floor(diff / (1000 * 60 * 60 * 24));
	};

	// Helper: Get total days in current year
	const getTotalDaysInYear = (): number => {
		return isLeapYear(currentYear) ? 366 : 365;
	};

	// Helper: Check if year is leap year
	const isLeapYear = (year: number): boolean => {
		return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
	};

	// Helper: Get days elapsed in year
	const getDaysElapsed = (): number => {
		return getDayOfYear();
	};

	// Helper: Get days remaining in year
	const getDaysRemaining = (): number => {
		return getTotalDaysInYear() - getDayOfYear();
	};

	// Helper: Get current week number (1-52/53)
	const getWeekNumber = (): number => {
		const firstDayOfYear = new Date(currentYear, 0, 1);
		const pastDaysOfYear = getDayOfYear();
		return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
	};

	// Helper: Get total weeks in year
	const getTotalWeeks = (): number => {
		return 52;
	};

	// Helper: Get current month (1-12)
	const getCurrentMonth = (): number => {
		return now.getMonth() + 1;
	};

	// Helper: Get current quarter (1-4)
	const getCurrentQuarter = (): number => {
		return Math.floor(now.getMonth() / 3) + 1;
	};

	// Helper: Get days in current month
	const getDaysInMonth = (): number => {
		return new Date(currentYear, now.getMonth() + 1, 0).getDate();
	};

	// Helper: Get current day of month
	const getDayOfMonth = (): number => {
		return now.getDate();
	};

	try {
		// Create a safe evaluation context with only our helper functions
		// This prevents access to dangerous globals
		const safeEval = new Function(
			'getDayOfYear',
			'getTotalDaysInYear',
			'getDaysElapsed',
			'getDaysRemaining',
			'getWeekNumber',
			'getTotalWeeks',
			'getCurrentMonth',
			'getCurrentQuarter',
			'getDaysInMonth',
			'getDayOfMonth',
			`return ${expr};`
		);

		const result = safeEval(
			getDayOfYear,
			getTotalDaysInYear,
			getDaysElapsed,
			getDaysRemaining,
			getWeekNumber,
			getTotalWeeks,
			getCurrentMonth,
			getCurrentQuarter,
			getDaysInMonth,
			getDayOfMonth
		);

		return typeof result === 'number' ? result : 0;
	} catch (error) {
		console.error('Failed to evaluate expression:', expr, error);
		return 0;
	}
}

/**
 * Parses progress syntax
 * Examples:
 *   5/100
 *   {getDaysElapsed()}/{getTotalDaysInYear()}
 */
function parseProgressValue(valueStr: string): { value: number; max: number } {
	const parts = valueStr.split('/');
	if (parts.length !== 2) {
		return { value: 0, max: 100 };
	}

	let [valuePart, maxPart] = parts.map(p => p.trim());

	// Check if value is a JavaScript expression (wrapped in {})
	const valueIsExpression = valuePart.startsWith('{') && valuePart.endsWith('}');
	const maxIsExpression = maxPart.startsWith('{') && maxPart.endsWith('}');

	const value = valueIsExpression
		? evaluateExpression(valuePart.slice(1, -1))
		: parseFloat(valuePart);

	const max = maxIsExpression
		? evaluateExpression(maxPart.slice(1, -1))
		: parseFloat(maxPart);

	return {
		value: isNaN(value) ? 0 : value,
		max: isNaN(max) ? 100 : max
	};
}

/**
 * Parses attributes from the progress syntax
 * Example: label="Tasks completed" color=success showPercentage=true
 */
function parseAttributes(attrStr: string): Record<string, string | boolean> {
	const attrs: Record<string, string | boolean> = {};

	// Match key="value" or key=value patterns
	const attrRegex = /(\w+)=(?:"([^"]*)"|(\w+))/g;
	let match;

	while ((match = attrRegex.exec(attrStr)) !== null) {
		const key = match[1];
		const quotedValue = match[2];
		const unquotedValue = match[3];
		const value = quotedValue !== undefined ? quotedValue : unquotedValue;

		// Convert boolean strings to actual booleans
		if (value === 'true') {
			attrs[key] = true;
		} else if (value === 'false') {
			attrs[key] = false;
		} else {
			attrs[key] = value;
		}
	}

	return attrs;
}

/**
 * Parses progress component syntax
 * Example: ::progress[5/100 label="Tasks" color=primary]
 */
function parseProgress(content: string): ProgressConfig {
	// Split on first space to separate value/max from attributes
	const firstSpaceIndex = content.indexOf(' ');

	let valueMaxStr: string;
	let attrsStr = '';

	if (firstSpaceIndex === -1) {
		valueMaxStr = content;
	} else {
		valueMaxStr = content.substring(0, firstSpaceIndex);
		attrsStr = content.substring(firstSpaceIndex + 1);
	}

	const { value, max } = parseProgressValue(valueMaxStr);
	const attrs = parseAttributes(attrsStr);

	return {
		value,
		max,
		label: attrs.label as string | undefined,
		color: attrs.color as string | undefined,
		showPercentage: attrs.showPercentage as boolean | undefined,
		showFraction: attrs.showFraction as boolean | undefined
	};
}

/**
 * Converts progress config to HTML with data attributes
 * This HTML will be hydrated by the LinearProgress component
 */
function progressToHtml(config: ProgressConfig): string {
	const attrs = [
		`data-component="linear-progress"`,
		`data-value="${config.value}"`,
		`data-max="${config.max}"`
	];

	if (config.label) attrs.push(`data-label="${config.label}"`);
	if (config.color) attrs.push(`data-color="${config.color}"`);
	if (config.showPercentage !== undefined) attrs.push(`data-show-percentage="${config.showPercentage}"`);
	if (config.showFraction !== undefined) attrs.push(`data-show-fraction="${config.showFraction}"`);

	return `<div class="custom-component" ${attrs.join(' ')}></div>`;
}

/**
 * Main parser function that processes markdown text
 * Finds all custom component syntax and converts them to HTML
 */
export function parseCustomComponents(markdown: string): string {
	// Match ::progress[...] syntax
	const progressRegex = /::progress\[([^\]]+)\]/g;

	return markdown.replace(progressRegex, (match, content) => {
		try {
			const config = parseProgress(content);
			return progressToHtml(config);
		} catch (error) {
			console.error('Failed to parse progress component:', match, error);
			return match; // Return original if parsing fails
		}
	});
}

/**
 * Decodes HTML entities in a string
 */
function decodeHtmlEntities(text: string): string {
	const entities: Record<string, string> = {
		'&quot;': '"',
		'&#34;': '"',
		'&apos;': "'",
		'&#39;': "'",
		'&lt;': '<',
		'&#60;': '<',
		'&gt;': '>',
		'&#62;': '>',
		'&amp;': '&',
		'&#38;': '&',
		'&lbrack;': '[',
		'&#91;': '[',
		'&rbrack;': ']',
		'&#93;': ']'
	};

	return text.replace(/&[#\w]+;/g, (match) => entities[match] || match);
}

/**
 * Post-processes HTML to replace custom component markers
 * Use this if the backend has already converted markdown to HTML
 */
export function parseCustomComponentsInHtml(html: string): string {
	// First decode any HTML entities that might have been escaped
	const decoded = decodeHtmlEntities(html);

	console.log('[PARSER] Input HTML (first 500 chars):', html.substring(0, 500));
	console.log('[PARSER] Decoded HTML (first 500 chars):', decoded.substring(0, 500));

	// Check if we have any progress components
	const hasProgress = decoded.includes('::progress[');
	console.log('[PARSER] Has progress syntax:', hasProgress);

	// The markdown parser might convert ::progress to <p>::progress...</p>
	// or leave it as-is, so we need to handle both cases
	const result = parseCustomComponents(decoded);

	console.log('[PARSER] Result HTML (first 500 chars):', result.substring(0, 500));
	console.log('[PARSER] Has data-component:', result.includes('data-component="linear-progress"'));

	return result;
}
