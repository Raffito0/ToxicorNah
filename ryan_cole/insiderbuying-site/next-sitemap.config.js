/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://earlyinsider.com',
  generateRobotsTxt: true,
  changefreq: 'weekly',
  priority: 0.7,
  exclude: ['/api/*', '/_next/*'],
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/_next/'],
      },
    ],
  },
  transform: async (config, path) => {
    // Homepage gets highest priority
    if (path === '/') {
      return { loc: path, changefreq: 'daily', priority: 1.0 };
    }
    // Blog articles get high priority and daily changefreq
    if (path.startsWith('/blog/') && path !== '/blog') {
      return { loc: path, changefreq: 'daily', priority: 0.8 };
    }
    // Blog listing
    if (path === '/blog') {
      return { loc: path, changefreq: 'daily', priority: 0.8 };
    }
    // Alerts page (frequently updated)
    if (path === '/alerts') {
      return { loc: path, changefreq: 'hourly', priority: 0.9 };
    }
    // Static pages
    return {
      loc: path,
      changefreq: config.changefreq,
      priority: config.priority,
    };
  },
};
