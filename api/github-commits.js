export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'GITHUB_TOKEN 환경변수가 설정되지 않았습니다.' });
  }

  try {
    const response = await fetch(
      'https://api.github.com/repos/kaha1122/MultiTranslator/commits?per_page=10',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.message });
    }

    const commits = await response.json();
    const simplified = commits.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message,
      author: c.commit.author.name,
      date: c.commit.author.date,
      url: c.html_url,
    }));

    return res.status(200).json(simplified);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
