import { z } from 'zod';

export const linkCleaningSchema = z
  .object({
    enabled: z.boolean(),
    everySite: z.array(z.string().regex(/^[A-Za-z0-9_.\-~[\]]{1,100}\*?$/)).max(500),
    sites: z
      .array(
        z
          .object({
            domain: z
              .string()
              .max(253)
              .regex(/^(?!www\.)[a-z0-9-]+(\.[a-z0-9-]+)+$/),
            strip: z.array(z.string().regex(/^[A-Za-z0-9_.\-~[\]]{1,100}\*?$/)).max(100),
            keep: z.array(z.string().regex(/^[A-Za-z0-9_.\-~[\]]{1,100}\*?$/)).max(100),
          })
          .strict(),
      )
      .max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    const domains = value.sites.map((site) => site.domain);
    if (new Set(domains).size !== domains.length)
      ctx.addIssue({ code: 'custom', message: 'Site domains must be unique', path: ['sites'] });
  });

export type LinkCleaning = z.infer<typeof linkCleaningSchema>;

export const LINK_CLEANING_DEFAULTS: LinkCleaning = {
  enabled: true,
  everySite:
    'utm_* fbclid gclid gbraid wbraid dclid msclkid yclid ttclid twclid li_fat_id igshid igsh mc_cid mc_eid _hsenc _hsmi __hstc __hssc __hsfp hsCtaTracking mkt_tok _gl vero_id oly_anon_id oly_enc_id rb_clickid s_cid wickedid srsltid'.split(
      ' ',
    ),
  sites: [
    ['youtube.com', 'si feature pp'],
    ['youtu.be', 'si feature pp'],
    ['open.spotify.com', 'si context'],
    ['x.com', 's t ref_src ref_url'],
    ['twitter.com', 's t ref_src ref_url'],
    ['instagram.com', 'igsh'],
    ['linkedin.com', 'trk trackingId lipi rcm'],
    ['reddit.com', 'share_id rdt'],
    ['nytimes.com', 'smid smtyp'],
    ['medium.com', 'source'],
  ].map(([domain, strip]) => ({ domain: domain ?? '', strip: (strip ?? '').split(' '), keep: [] })),
};
