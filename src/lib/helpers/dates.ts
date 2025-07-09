export function formatDate(date: Date): string {
	if (!date) return '';
	return date.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});
}

export function formatDateTime(date: Date): string {
	if (!date) return '';
	return date.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
}
