const files: Record<string, Record<string, string>> = {
  'dungeon-crawler-carl': { audio: '10_SYUSwZwMzUae3YVZ4qQr-HKFX-cf_a', prepared: '1WWTZyxBz9YYbDf7Y6hfRhauYR8erUYLT', epub: '1_pkY8LQ4d_jwvh61FLe6X5IGPt7o6oeE', alignment: '1lCRdBXLG8UdggN6B8j7Vk2ByH4GRDEzq' },
  "the-car": {"audio": "1pjIxN4uISRCEVRjKIXwYY_wag9x9W7pi", "prepared": "1WpJgogtvI0t6d7GU7vgfTQsVTwZvKvr-", "epub": "1xMAkEsN_D4U9eCpTuRRkcl2HPCh3MehX", "alignment": "18HG1Idfw3fO2wngjVA4antcqlMnUbwHG", "cover": "1XGRrtpMA9Iy3qPc0JgSSXjnI9hvDsm5l"},
  "scythe": {"audio": "1-zyKxmuFsuB9T078xNuTEdV3qDOGPNiE", "prepared": "1w71H201njkS8eGBxxKfKuXh9yBaQTtYG", "epub": "1H8JXADJxHwWUYA-8u_jxuGo4yDL2TE53", "alignment": "1LbB61VgxOGGn6UcW3mIeJa4xZYM0SgBW", "cover": "1zuCMBncZqR8dqBiaq_2pCywZH0iE1C-2"},
  "eragon": {"audio": "1RF-J7mzZoG3AJzHM2dj9resgIs5rXrbW", "prepared": "1F6u0OWPWrJenembohmY-2FFVAI0_k4i0", "epub": "1mWSCDFj2cnCndtwzLvtzi5XAqIWBascu", "alignment": "1-V8IsF1SykHnZD2BcGMkpE2hWuT8mqpH", "cover": "1TSbFN7oSxsC4wj7J-JxzESxU-LqWF59m"},
  "project-hail-mary": {"audio": "19EBL2jgPQF6DFpTCVEjo9An99wgqI94L", "prepared": "1TDYNIIX78ohGncIHZVtFd1WEORB9ooCU", "epub": "1WolXvTtv99RqxkIkkPzeF5lv12IvW7zr", "alignment": "1Nzm0QxN4q-ArY6VZXh4rseUK8xWRIkPb", "cover": "1oEoe34k3638n45QvRWJSbll-u2cRYSw3"},
  "just-mercy": {"audio": "1Sp-XYQWbs0g6iOjQpl0hpg7Lo_Q12SyW", "prepared": "1ScJgBpD5YDCkha2H--FcUn8hzZ8-3wAT", "epub": "1AKrSzEmc5DY-mQA3vkgC_1RjO941e1Vy", "alignment": "1jow8e9prX0w9P3-E2hcRCe2X5y24Pw8Y", "cover": "13QsFZ6mtYOBSNHebSJ7_Zh_wQVkuWceu"},
  "the-martian": {"audio": "1qfXdR8rL6eK_1G5nLeTzO4UudNqvuslg", "prepared": "1BRbf4C22MzGYHepCpDTV26VZnqGo-BH5", "epub": "1DYux1Dz-z1amrUygf-X92hRD1GylZQ-B", "alignment": "19LeJq-SQyArGBnEJz80ixs4kCBDqIaot", "cover": "1tNhRqXt15t5f16VMMj100_Ih6DF7Nm9i"},
};

export function driveURL(book: string, asset: string) {
  const id = files[book]?.[asset];
  if (!id) return '';
  const key = process.env.NEXT_PUBLIC_DRIVE_API_KEY;
  if (!key) return '';
  return `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${encodeURIComponent(key)}`;
}

export async function driveFailure(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: { errors?: { reason?: string }[] } };
    if (payload.error?.errors?.some((e: { reason?: string }) => e.reason === 'downloadQuotaExceeded')) {
      return "Google Drive's download limit is blocking this book. Try again later.";
    }
  } catch {
    // Non-JSON failures retain the original procedural message.
  }
  return fallback;
}
