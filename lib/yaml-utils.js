/**
 * YAML Utilities
 *
 * Shared utilities for converting JavaScript objects to YAML format.
 * Used across dependency monitoring modules.
 */

/**
 * Converts a JavaScript object to YAML format with proper quoting and escaping
 *
 * Recursively converts nested objects and arrays to properly indented YAML.
 * Handles:
 * - Arrays (converted to YAML list format with `-` prefix)
 * - Objects (converted to key-value pairs with proper indentation)
 * - Primitive values (strings, numbers, booleans) with proper quoting/escaping
 * - Special YAML characters requiring quotes: : # - | > [ ] { } @ `
 * - Multiline strings and empty values
 *
 * @param {*} obj - The object to convert to YAML
 * @param {number} [indent=0] - Current indentation level (number of spaces)
 * @returns {string} YAML-formatted string representation of the object
 *
 * @example
 * ```javascript
 * const config = {
 *   updates: [
 *     { 'package-ecosystem': 'npm', directory: '/' }
 *   ]
 * }
 * console.log(convertToYaml(config))
 * // Output:
 * // updates:
 * //   - package-ecosystem: npm
 * //     directory: /
 * ```
 */
/**
 * Safely formats a YAML value with proper quoting and escaping
 * @param {*} value - The value to format
 * @returns {string} Safely formatted YAML value
 */
function formatYamlValue(value) {
  // Handle null and undefined
  if (value == null) {
    return 'null'
  }

  // Handle booleans and numbers - output as-is
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value)
  }

  // Convert to string
  const str = String(value)

  // Handle empty strings
  if (str === '') {
    return '""'
  }

  // Check if string contains special YAML characters that require quoting
  const needsQuotes =
    /[:#\-|>[\]{}@`\n\r]/.test(str) ||
    /^[*&!%,?'"]/.test(str) ||
    str.startsWith(' ') ||
    str.endsWith(' ') ||
    /^(true|false|yes|no|on|off|null|~)$/i.test(str) ||
    /^\d/.test(str)

  if (needsQuotes) {
    // Escape double quotes and backslashes within the string
    const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return `"${escaped}"`
  }

  return str
}

function convertToYaml(obj, indent = 0) {
  const spaces = ' '.repeat(indent)
  let yaml = ''

  if (Array.isArray(obj)) {
    obj.forEach(item => {
      if (typeof item === 'object' && item !== null) {
        // For objects in arrays, prefix first line with "- " and indent rest
        const entries = Object.entries(item)
        entries.forEach(([key, value], idx) => {
          const safeKey = formatYamlValue(key)
          const prefix = idx === 0 ? `${spaces}- ` : `${spaces}  `

          if (Array.isArray(value)) {
            yaml += `${prefix}${safeKey}:\n`
            yaml += convertToYaml(value, indent + 4)
          } else if (typeof value === 'object' && value !== null) {
            yaml += `${prefix}${safeKey}:\n`
            yaml += convertToYaml(value, indent + 4)
          } else {
            yaml += `${prefix}${safeKey}: ${formatYamlValue(value)}\n`
          }
        })
      } else {
        yaml += `${spaces}- ${formatYamlValue(item)}\n`
      }
    })
  } else if (typeof obj === 'object' && obj !== null) {
    Object.entries(obj).forEach(([key, value]) => {
      const safeKey = formatYamlValue(key)
      if (Array.isArray(value)) {
        yaml += `${spaces}${safeKey}:\n`
        yaml += convertToYaml(value, indent + 2)
      } else if (typeof value === 'object' && value !== null) {
        yaml += `${spaces}${safeKey}:\n`
        yaml += convertToYaml(value, indent + 2)
      } else {
        yaml += `${spaces}${safeKey}: ${formatYamlValue(value)}\n`
      }
    })
  }

  return yaml
}

module.exports = {
  convertToYaml,
}
