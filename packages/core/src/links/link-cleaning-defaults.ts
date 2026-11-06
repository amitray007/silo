export interface LinkCleaning {
  enabled: boolean;
  everySite: string[];
  sites: { domain: string; strip: string[]; keep: string[] }[];
}

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
    ['instagram.com', 'igsh img_index'],
    ['linkedin.com', 'trk trackingId lipi rcm'],
    ['reddit.com', 'share_id rdt'],
    ['nytimes.com', 'smid smtyp'],
    ['medium.com', 'source'],
  ].map(([domain, strip]) => ({ domain: domain ?? '', strip: (strip ?? '').split(' '), keep: [] })),
};
