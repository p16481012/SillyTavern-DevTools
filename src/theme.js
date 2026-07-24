export function inferPanelThemeFromTextColor(color) {
    const channels = String(color)
        .match(/\d+(?:\.\d+)?/g)
        ?.slice(0, 3)
        .map(Number);
    if (!channels || channels.length < 3 || channels.some(Number.isNaN)) {
        return 'dark';
    }
    const luminance = (channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722) / 255;
    return luminance >= 0.55 ? 'dark' : 'light';
}
