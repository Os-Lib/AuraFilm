const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;

module.exports = function withNetworkSecurityConfig(config) {
  config = withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0];
    if (app && app.$) {
      app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
      app.$['android:usesCleartextTraffic'] = 'true';
    }
    return config;
  });

  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const resXmlDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml'
      );
      if (!fs.existsSync(resXmlDir)) {
        fs.mkdirSync(resXmlDir, { recursive: true });
      }
      fs.writeFileSync(path.join(resXmlDir, 'network_security_config.xml'), xmlContent, 'utf8');
      return config;
    },
  ]);

  return config;
};
