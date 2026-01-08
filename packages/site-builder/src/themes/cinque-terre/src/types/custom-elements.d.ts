/**
 * Type declarations for custom HTML elements used in the theme
 */

declare namespace JSX {
    interface IntrinsicElements {
        'el-popover': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
            id?: string;
            anchor?: string;
            popover?: string;
        }, HTMLElement>;
    }
}
