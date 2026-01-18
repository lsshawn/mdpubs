# Custom Components - Linear Progress Examples

This document demonstrates the custom progress bar component syntax for MdPubs markdown notes.

## Syntax

The basic syntax is: `::progress[value/max attributes]`

## Static Progress Examples

### Basic Progress Bar
Simple progress with hardcoded values:

```markdown
::progress[5/100]
```

::progress[5/100]

### Progress with Label
Add a descriptive label to your progress bar:

```markdown
::progress[25/100 label="Tasks completed"]
```

::progress[25/100 label="Tasks completed"]

### Progress with Colors
Choose from different color schemes:

```markdown
::progress[75/100 label="Success rate" color=success]
```

::progress[75/100 label="Success rate" color=success]

```markdown
::progress[45/100 label="Warning level" color=warning]
```

::progress[45/100 label="Warning level" color=warning]

```markdown
::progress[90/100 label="Critical" color=error]
```

::progress[90/100 label="Critical" color=error]

Available colors: `primary`, `secondary`, `accent`, `success`, `warning`, `error`

### Show Fraction
Display the actual numbers alongside the percentage:

```markdown
::progress[342/500 label="Pages read" showFraction=true]
```

::progress[342/500 label="Pages read" showFraction=true]

### Hide Percentage
Hide the percentage text on the bar:

```markdown
::progress[7/10 label="Stars" showPercentage=false]
```

::progress[7/10 label="Stars" showPercentage=false]

## Dynamic Progress Examples (JavaScript Functions)

### Year Progress
Track how much of the year has passed:

```markdown
::progress[{getDaysElapsed()}/{getTotalDaysInYear()} label="Year progress"]
```

::progress[{getDaysElapsed()}/{getTotalDaysInYear()} label="Year progress"]

### Days Remaining This Year
Show how many days are left in the current year:

```markdown
::progress[{getDaysRemaining()}/{getTotalDaysInYear()} label="Days remaining in year" color=warning]
```

::progress[{getDaysRemaining()}/{getTotalDaysInYear()} label="Days remaining in year" color=warning]

### Week Progress
Track weeks in the current year:

```markdown
::progress[{getWeekNumber()}/52 label="Weeks this year" color=accent]
```

::progress[{getWeekNumber()}/52 label="Weeks this year" color=accent]

### Month Progress
Track progress through the current month:

```markdown
::progress[{getDayOfMonth()}/{getDaysInMonth()} label="Month progress" showFraction=true]
```

::progress[{getDayOfMonth()}/{getDaysInMonth()} label="Month progress" showFraction=true]

### Quarter Progress
Track which quarter we're in (1-4):

```markdown
::progress[{getCurrentQuarter()}/4 label="Quarter progress" color=secondary]
```

::progress[{getCurrentQuarter()}/4 label="Quarter progress" color=secondary]

## Available JavaScript Helper Functions

When using dynamic expressions (wrapped in `{}`), you have access to these helper functions:

| Function | Description | Returns |
|----------|-------------|---------|
| `getDayOfYear()` | Current day of year (1-365/366) | number |
| `getTotalDaysInYear()` | Total days in current year (365 or 366) | number |
| `getDaysElapsed()` | Days that have passed in current year | number |
| `getDaysRemaining()` | Days remaining in current year | number |
| `getWeekNumber()` | Current week number (1-52) | number |
| `getTotalWeeks()` | Total weeks in a year (52) | number |
| `getCurrentMonth()` | Current month (1-12) | number |
| `getCurrentQuarter()` | Current quarter (1-4) | number |
| `getDaysInMonth()` | Total days in current month | number |
| `getDayOfMonth()` | Current day of month (1-31) | number |

## Advanced Examples

### Combining Multiple Progress Bars

Track multiple goals in a single note:

```markdown
## My 2026 Goals

### Reading Goal
::progress[23/52 label="Books read this year" color=success showFraction=true]

### Exercise Goal
::progress[{getWeekNumber()}/52 label="Weeks of exercise" color=primary showFraction=true]

### Project Completion
::progress[{getCurrentQuarter()}/4 label="Quarterly milestones" color=accent]
```

## My 2026 Goals

### Reading Goal
::progress[23/52 label="Books read this year" color=success showFraction=true]

### Exercise Goal
::progress[{getWeekNumber()}/52 label="Weeks of exercise" color=primary showFraction=true]

### Project Completion
::progress[{getCurrentQuarter()}/4 label="Quarterly milestones" color=accent]

---

### Project Tracking Dashboard

```markdown
## Project: MdPubs Custom Components

### Overall Progress
::progress[3/5 label="Features completed" color=primary showFraction=true]

### Testing Coverage
::progress[78/100 label="Test coverage %" color=success]

### Documentation
::progress[5/10 label="Docs pages" color=warning showFraction=true]
```

## Project: MdPubs Custom Components

### Overall Progress
::progress[3/5 label="Features completed" color=primary showFraction=true]

### Testing Coverage
::progress[78/100 label="Test coverage %" color=success]

### Documentation
::progress[5/10 label="Docs pages" color=warning showFraction=true]

---

## Tips and Best Practices

1. **Use labels for clarity** - Always add a `label` attribute to make your progress bars self-explanatory
2. **Choose appropriate colors** - Use semantic colors (success for completed, warning for attention needed)
3. **Dynamic vs Static** - Use static values for project tracking, dynamic for time-based progress
4. **Show fractions for countable items** - Add `showFraction=true` when tracking discrete items (books, tasks, etc.)
5. **Hide percentage for small ranges** - For progress like "3/5", the fraction is more meaningful than "60%"

## Future Component Ideas

This custom component system can be extended to support:
- `::chart[...]` - Inline charts and graphs
- `::counter[...]` - Animated counters
- `::calendar[...]` - Mini calendars with highlighted dates
- `::badge[...]` - Status badges and tags
- `::alert[...]` - Custom alert boxes
- `::table[...]` - Enhanced table rendering with sorting/filtering

---

**Note**: All progress bars update dynamically based on the current date/time when the page is loaded. Refresh the page to see updated values for time-based progress bars.
