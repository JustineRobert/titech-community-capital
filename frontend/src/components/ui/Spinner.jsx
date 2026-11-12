
import './Spinner.css';

/**
 * TITech Community Capital
 * Shared accessible loading indicator.
 *
 * Props:
 * - size: sm | md | lg
 * - label: accessible loading description
 * - showLabel: whether to display the description
 * - className: optional additional CSS classes
 */
const Spinner = ({
    size = 'md',
    label = 'Loading...',
    showLabel = false,
    className = '',
}) => {
    const sizeClasses = {
        sm: 'titech-spinner--sm',
        md: 'titech-spinner--md',
        lg: 'titech-spinner--lg',
    };

    const resolvedSize = sizeClasses[size] || sizeClasses.md;

    const classes = [
        'titech-spinner',
        resolvedSize,
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <span
            className={classes}
            role="status"
            aria-live="polite"
        >
            <span
                className="titech-spinner__ring"
                aria-hidden="true"
            />

            <span
                className={
                    showLabel
                        ? 'titech-spinner__label'
                        : 'titech-spinner__sr-only'
                }
            >
                {label}
            </span>
        </span>
    );
};

export default Spinner;
