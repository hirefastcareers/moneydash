export const Footer = () => {
    return (
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="max-sm:text-center">Saved in this browser only. Export a backup before you clear anything.</p>
            <p>
                Design by{" "}
                <a
                    className="hover:text-primary font-medium hover:underline"
                    href="https://paceui.com"
                    target="_blank"
                    rel="noreferrer">
                    PaceUI
                </a>
            </p>
        </div>
    );
};
