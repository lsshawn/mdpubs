<script lang="ts">
	interface Props {
		value: number;
		max: number;
		label?: string;
		color?: 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'error';
		showPercentage?: boolean;
		showFraction?: boolean;
	}

	let {
		value = 0,
		max = 100,
		label,
		color = 'primary',
		showPercentage = true,
		showFraction = false
	}: Props = $props();

	// Calculate percentage
	let percentage = $derived(Math.min(100, Math.max(0, (value / max) * 100)));

	// Color classes for DaisyUI
	const colorClasses = {
		primary: 'bg-primary',
		secondary: 'bg-secondary',
		accent: 'bg-accent',
		success: 'bg-success',
		warning: 'bg-warning',
		error: 'bg-error'
	};
</script>

<div class="linear-progress my-4 w-full">
	{#if label || showFraction}
		<div class="mb-2 flex items-center justify-between text-sm">
			{#if label}
				<span class="font-medium text-gray-700">{label}</span>
			{/if}
			{#if showFraction}
				<span class="text-gray-500">
					{value.toLocaleString()} / {max.toLocaleString()}
				</span>
			{/if}
		</div>
	{/if}

	<div class="relative h-4 w-full overflow-hidden rounded-full bg-gray-200">
		<div
			class="h-full transition-all duration-500 ease-out {colorClasses[color]}"
			style="width: {percentage}%"
			role="progressbar"
			aria-valuenow={value}
			aria-valuemin="0"
			aria-valuemax={max}
		></div>

		{#if showPercentage}
			<div class="absolute inset-0 flex items-center justify-center">
				<span class="text-xs font-semibold text-gray-700">
					{percentage.toFixed(1)}%
				</span>
			</div>
		{/if}
	</div>
</div>
