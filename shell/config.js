// Server-side settings for the Saphi shell. The proxy serves this file at
// /tv/config.js and loads it before /tv/saphi.js. Every key is optional; see
// DEFAULTS in saphi.js for the full list. Settings saved on the TV in
// localStorage ('saphi.config') take precedence over this file.
window.SaphiConfig = {
    // Send logs to the proxy's /tv/log and enable the on-screen log (blue key).
    debug: false,

    // Options for jellyfin-web's device profile builder. Turn more on once the
    // probe and test clips show they play, for example:
    //   supportsHevc: true, enableHls: true, maxVideoWidth: 3840
    profile: {
        enableMkvProgressive: false,
        enableSsaRender: true
    }

    // Remote keyCode -> action, for keys jellyfin-web does not know yet:
    // keyMap: { '19': 'Pause', '403': 'MediaStop' },
    // backspaceIsBack: true
};
