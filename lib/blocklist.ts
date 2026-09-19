// Content filter for the definition popup. Edit these lists to tune what students can see.

// Words whose definition is never shown (matched against the clicked word and its base forms).
export const blockedWords=new Set([
 'fuck','fucker','fucking','fuckin','fuckhead','motherfucker','motherfucking','clusterfuck',
 'shit','shitty','bullshit','shithead','horseshit',
 'bitch','bitchy','bastard','asshole','dumbass','arsehole','dickhead',
 'cunt','twat','prick','wank','wanker','whore','slut','skank','slutty',
 'nigger','nigga','faggot','fag','dyke','tranny','retard','spic','chink','kike','gook','wetback','coon','paki',
 'porn','porno','blowjob','handjob','cum','jizz','dildo','anal','tits','titty','boner','horny','masturbate','masturbation',
]);
export const isBlockedWord=(w:string)=>blockedWords.has(w);

// Definitions (or examples) matching this are dropped, so normal words like "screw" or "come" don't show sexual senses.
export const explicitPattern=/\b(sexual|sexually|sex|intercourse|genital|genitals|genitalia|penis|vagina|vulva|clitoris|testicles?|scrotum|orgasm|ejaculat\w*|masturbat\w*|erotic|erection|semen|prostitut\w*|fornicat\w*|copulat\w*|pornograph\w*)\b/i;
export const isExplicitSense=(definition:string,example?:string)=>explicitPattern.test(definition)||Boolean(example&&explicitPattern.test(example));
