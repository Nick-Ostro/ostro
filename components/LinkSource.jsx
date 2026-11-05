import { SOURCE_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

// The AGPL asks every page people use to offer the source of the version that runs it (lib/site.js).
export default function LinkSource({ className }) {
	return (
		<a
			href={SOURCE_URL}
			target="_blank"
			rel="noopener"
			className={cn("text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline", className)}
		>
			Source code
		</a>
	);
}
