import { arrayFrom, stringReplace, toSlug, supportRules, getCssRules } from './util'
import { win, doc, domainProp, onRetryProp, StyleElementCtor } from './constants'
import { getCurrentDomain, DomainMap } from './url'
import { InnerAssetsRetryOptions } from './assets-retry'

type UrlProperty = 'backgroundImage' | 'borderImage' | 'listStyleImage'
// cache for <link rel="stylesheet" />
const handledStylesheets: { [x: string]: boolean } = {}
// cache for <style />
const handledStyleTags: HTMLStyleElement[] = []

const insertRule = win.CSSStyleSheet.prototype.insertRule

const urlProperties: UrlProperty[] = ['backgroundImage', 'borderImage', 'listStyleImage']

const processRules = function(
    name: UrlProperty,
    rule: CSSStyleRule,
    styleSheet: CSSStyleSheet,
    styleRules: CSSStyleRule[],
    opts: InnerAssetsRetryOptions
) {
    const domainMap = opts[domainProp]
    const onRetry = opts[onRetryProp]
    const targetRule = rule.style && rule.style[name]
    if (!targetRule) {
        return
    }
    // skip data-uri
    if (/^url\(["']?data:/.test(targetRule)) {
        return
    }
    const [_, originalUrl] = targetRule.match(/^url\(["']?(.+?)["']?\)/) || []
    if (!originalUrl) {
        return
    }
    const currentDomain = getCurrentDomain(originalUrl, domainMap)
    if (!currentDomain || !domainMap[currentDomain]) {
        return
    }
    const urlList = Object.keys(domainMap)
        .map(domain => {
            const newUrl = stringReplace(originalUrl, currentDomain, domain)
            const userModifiedUrl = onRetry(newUrl, originalUrl, null)
            return `url("${userModifiedUrl}")`
        })
        .join(',')
    const cssText = rule.selectorText + `{ ${toSlug(name)}: ${urlList} !important; }`
    try {
        insertRule.call(styleSheet, cssText, styleRules.length)
    } catch (_) {
        insertRule.call(styleSheet, cssText, 0)
    }
}

const processStyleSheets = (styleSheets: CSSStyleSheet[], opts: InnerAssetsRetryOptions) => {
    styleSheets.forEach((styleSheet: CSSStyleSheet) => {
        const rules = getCssRules(styleSheet)
        if (rules === null) {
            return
        }
        const styleRules = arrayFrom(rules) as CSSStyleRule[]
        styleRules.forEach(rule => {
            urlProperties.forEach(cssProperty => {
                processRules(cssProperty, rule, styleSheet, styleRules, opts)
            })
        })

        if (styleSheet.href) {
            handledStylesheets[styleSheet.href] = true
        }
        if (styleSheet.ownerNode instanceof StyleElementCtor) {
            handledStyleTags.push(styleSheet.ownerNode)
        }
    })
}

const getStyleSheetsToBeHandled = (styleSheets: StyleSheetList, domainMap: DomainMap): CSSStyleSheet[] => {
    const sheetsArray = arrayFrom(styleSheets) as unknown as CSSStyleSheet[];
    return sheetsArray.filter(styleSheet => {
        if (!supportRules(styleSheet)) {
            return false
        }
        // <style /> tags
        if (!styleSheet.href) {
            const ownerNode = styleSheet.ownerNode
            if (ownerNode instanceof StyleElementCtor && handledStyleTags.indexOf(ownerNode) > -1) {
                return false
            }
            // use CSSStyleSheet.insertRule
            if (ownerNode instanceof StyleElementCtor && !ownerNode.innerHTML) {
                return false
            }
            return true
        }
        if (handledStylesheets[styleSheet.href]) {
            return false
        }
        const currentDomain = getCurrentDomain(styleSheet.href, domainMap)
        return !!currentDomain
    })
}

const setInsertRuleHandle = (opts: InnerAssetsRetryOptions) => {
    win.CSSStyleSheet.prototype.insertRule = function (rule, index) {
        const insertIndex = insertRule.call(this, rule, index)
        const styleSheet = this
        const rules = getCssRules(styleSheet)
        if (rules === null) {
            return insertIndex
        }
        const styleRules = arrayFrom(rules) as CSSStyleRule[]
        urlProperties.forEach(cssProperty => {
            processRules(cssProperty, styleRules[insertIndex], styleSheet, styleRules, opts)
        })
        return index || 0
    }
}

export default function initCss(opts: InnerAssetsRetryOptions) {
    // detect is support styleSheets
    const supportStyleSheets = doc.styleSheets
    const domainMap = opts[domainProp]
    if (!supportStyleSheets) return false

    setInsertRuleHandle(opts)

    setInterval(() => {
        const newStyleSheets = getStyleSheetsToBeHandled(doc.styleSheets, domainMap)
        if (newStyleSheets.length > 0) {
            processStyleSheets(newStyleSheets, opts)
        }
    }, 250)
}
