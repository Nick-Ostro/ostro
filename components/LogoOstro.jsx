import { cn } from "@/lib/utils";

// A pigeon facing right: its body with the eye and the wing cut out, the wing in a lighter shade, and the beak in
// Ostro's accent. The share images and the brand icon draw the same shapes, so they import these.
export const LOGO_VIEWBOX = "32 24 168 168";
export const LOGO_FACETS = {
	upper:
		"M42 118C42 84 72 70 104 74C116 50 140 40 160 46C182 52 188 76 176 92C170 100 168 108 170 118C172 150 140 170 104 170C70 170 46 150 42 118Z M156 64a7 7 0 1 0 14 0a7 7 0 1 0-14 0Z M70 114C86 94 124 94 138 114C124 128 92 134 70 114Z",
	lower: "M70 114C86 94 124 94 138 114C124 128 92 134 70 114Z",
	beak: "M179 68 197 75 179 82Z",
};
export const LOGO_SHADE = 0.35;
export const LOGO_ACCENT = "#C4471F";

export default function LogoOstro({ className }) {
	return (
		<svg viewBox={LOGO_VIEWBOX} aria-hidden="true" className={cn("size-6 shrink-0 text-foreground", className)}>
			<path d={LOGO_FACETS.upper} fill="currentColor" fillRule="evenodd" />
			<path d={LOGO_FACETS.lower} fill="currentColor" fillOpacity={LOGO_SHADE} />
			<path d={LOGO_FACETS.beak} fill={LOGO_ACCENT} />
		</svg>
	);
}
