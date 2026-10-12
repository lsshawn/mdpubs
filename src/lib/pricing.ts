/**
 * Regional price lists, picked by the visitor's IP country (see the root
 * +layout.server.ts). Modelled on impactora-site src/lib/data/region.ts.
 *
 * Stripe charges the same amounts: the live monthly and yearly prices carry
 * MYR and SGD `currency_options`, and Payment Links show the visitor's local
 * currency from their IP. So the links stay the same everywhere; only the copy
 * changes. Change an amount here and in Stripe together.
 */

export type PriceRegion = 'US' | 'MY' | 'SG';

export type Pricing = {
	region: PriceRegion;
	/** Formatted amounts, e.g. "RM 85", "S$25", "$20". */
	monthly: string;
	yearly: string;
	/** What a year costs less than twelve months, formatted. */
	yearlySaving: string;
	/** Currency prefix for other amounts on the page, e.g. the demo contract total. */
	symbol: string;
	/**
	 * DocuSign's per-seat price for the landing page's comparison. Kept in USD
	 * (what DocuSign lists) but marked US$ outside the US, so it never reads as
	 * the same currency as a ringgit or SGD price beside it.
	 */
	docusign: string;
};

const LISTS: Record<PriceRegion, { symbol: string; monthly: number; yearly: number }> = {
	US: { symbol: '$', monthly: 20, yearly: 190 },
	MY: { symbol: 'RM ', monthly: 85, yearly: 800 },
	SG: { symbol: 'S$', monthly: 25, yearly: 250 }
};

/** The price list for an ISO country code (Cloudflare's cf-ipcountry). USD by default. */
export function pricingFor(country: string | null | undefined): Pricing {
	const cc = country?.toUpperCase();
	const region: PriceRegion = cc === 'MY' || cc === 'SG' ? cc : 'US';
	const { symbol, monthly, yearly } = LISTS[region];
	return {
		region,
		monthly: `${symbol}${monthly}`,
		yearly: `${symbol}${yearly}`,
		yearlySaving: `${symbol}${monthly * 12 - yearly}`,
		symbol,
		docusign: region === 'US' ? '$40' : 'US$40'
	};
}
