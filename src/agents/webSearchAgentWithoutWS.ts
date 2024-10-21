import { BaseMessage } from '@langchain/core/messages';
import { PromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence, RunnableLambda } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Document } from '@langchain/core/documents';
import { searchSearxng } from '../lib/searxng';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import LineOutputParser from '../lib/outputParsers/lineOutputParser';
import { ChatOpenAI } from '@langchain/openai';
import axios from 'axios';
import * as cheerio from 'cheerio';
import url_summary_schema from '../db/mongodb/summary';
import {
  getClaudeApiKey,
  getOpenaiApiKey,
  getSlackBotKey,
  getSlackErrorChannel,
} from '../config';
import puppeteer from 'puppeteer';

const OPENAI_API_KEY = getOpenaiApiKey();
const CLAUDE_API_KEY = getClaudeApiKey();
const SLACK_ERROR_CHANEEL_ID = getSlackErrorChannel();
const SLACK_BOT_KEY = getSlackBotKey();

//Error Slack
const sendErrorSlackMessage = async (error) => {
  try {
    const text = `${error}`;
    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        channel: SLACK_ERROR_CHANEEL_ID,
        text: text,
      },
      {
        headers: {
          Authorization: `Bearer ${SLACK_BOT_KEY}`,
          'Content-Type': 'application/json',
        },
      },
    );
    if (response.data.ok) {
      return true;
    }
  } catch (error) {
    console.log('Slack error');
  }
};

const prompt = `As a professional summarizer, create a concise and comprehensive summary of the provided text, be it an article, post, conversation, or passage, while adhering to these guidelines:

Craft a summary that is detailed, thorough, in-depth, and complex, while maintaining clarity and conciseness.

Incorporate main ideas and essential information, eliminating extraneous language and focusing on critical aspects.

Rely strictly on the provided text, without including external information.

Format the summary in paragraph form for easy understanding.

Text to summarise:
"{{blog_content}}"`;

const redditPrompt = `As a professional summarizer, create a concise and comprehensive summary of the provided text, be it an article, post, conversation, or passage, while adhering to these guidelines:
Craft a summary that is detailed, thorough, in-depth, and complex, while maintaining clarity and conciseness.
Incorporate main ideas and essential information, eliminating extraneous language and focusing on critical aspects. Do not include any meta-information about the post itself, such as upvotes, comments.
Exclude all personal information, including usernames, real names, or any identifying details of the original poster or other users mentioned in the post.
Do not mention Reddit, subreddits, or any platform-specific terminology in your summary.
Rely strictly on the provided text, without including external information.
Format the summary in paragraph form for easy understanding.
Text to summarise:
{{reddit_data}}`;

const getSummaryFromClaude = async (prompt, url) => {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',

      {
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      },
    );
    return response.data;
  } catch (error) {
    await sendErrorSlackMessage(`*Error - AI Summary* \n URL : ${url}`);
    console.log(`Error - AI Summary: ${error}`);
    return { error: 'error' };
  }
};

const getSummaryFromChatGpt = async (prompt, url) => {
  const data = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  };

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
      },
    );
    return response.data;
  } catch (error) {
    await sendErrorSlackMessage(`*Error - AI Summary* \n URL : ${url}`);

    console.log(`Error - AI Summary: ${error}`);
    return { error: 'error' };
  }
};
const checkDBdataExist = async (url) => {
  try {
    const dataExist = await url_summary_schema.findOne({ url });
    return dataExist ? dataExist : '';
  } catch (error) {
    console.log(`Error - DB: ${error}`);
    await sendErrorSlackMessage(`*Error - DB* \n URL : ${url}`);
    return '';
  }
};

const getSummaryData = async (data) => {
  try {
    const url = data?.url;
    const content = data?.pageContent?.content
      ? data?.pageContent?.content
      : '';
    const word_count = data?.pageContent?.word_count
      ? data?.pageContent?.word_count
      : 0;
    const dataExist = await checkDBdataExist(url);
    if (dataExist) {
      const usage = dataExist.summary.usage;
      return {
        id: dataExist.summary.id,
        summary: url.includes('reddit')
          ? dataExist.summary.content[0].text
          : dataExist.summary.choices[0].message.content,
        token: usage,
        model: dataExist.summary.model,
        url,
        word_count: dataExist.word_count,
      };
    }
    const promptData = url.includes('reddit')
      ? redditPrompt.replace('{{reddit_data}}', content)
      : prompt.replace('{{blog_content}}', content);
    const summary = url.includes('reddit')
      ? await getSummaryFromClaude(promptData, url)
      : await getSummaryFromChatGpt(promptData, url);
    if (!summary?.error) {
      const newDoc = new url_summary_schema({
        url,
        summary,
        word_count,
      });
      await newDoc.save();
      const usage = summary.usage;
      return {
        id: summary.id,
        summary: url.includes('reddit')
          ? summary.content[0].text
          : summary.choices[0].message.content,
        token: usage,
        model: summary.model,
        url,
        word_count,
      };
    }
  } catch (error) {
    await sendErrorSlackMessage(`*Error - DB* \n URL : ${data.metadata.url}`);
    console.log(`Error - DB: ${error}`);
    return { error: 'error' };
  }
};

const basicSearchRetrieverPrompt = `
You are an AI question rephraser. You will be given a conversation and a follow-up question,  you will have to rephrase the follow up question so it is a standalone question and can be used by another LLM to search the web for information to answer it.
If it is a smple writing task or a greeting (unless the greeting contains a question after it) like Hi, Hello, How are you, etc. than a question then you need to return \`not_needed\` as the response (This is because the LLM won't need to search the web for finding information on this topic).
If the user asks some question from some URL or wants you to summarize a PDF or a webpage (via URL) you need to return the links inside the \`links\` XML block and the question inside the \`question\` XML block. If the user wants to you to summarize the webpage or the PDF you need to return \`summarize\` inside the \`question\` XML block in place of a question and the link to summarize in the \`links\` XML block.
You must always return the rephrased question inside the \`question\` XML block, if there are no links in the follow-up question then don't insert a \`links\` XML block in your response.

There are several examples attached for your reference inside the below \`examples\` XML block

<examples>
1. Follow up question: What is the capital of France
Rephrased question:\`
<question>
Capital of france
</question>
\`

2. Hi, how are you?
Rephrased question\`
<question>
not_needed
</question>
\`

3. Follow up question: What is Docker?
Rephrased question: \`
<question>
What is Docker
</question>
\`

4. Follow up question: Can you tell me what is X from https://example.com
Rephrased question: \`
<question>
Can you tell me what is X?
</question>

<links>
https://example.com
</links>
\`

5. Follow up question: Summarize the content from https://example.com
Rephrased question: \`
<question>
summarize
</question>

<links>
https://example.com
</links>
\`
</examples>

Anything below is the part of the actual conversation and you need to use conversation and the follow-up question to rephrase the follow-up question as a standalone question based on the guidelines shared above.

<conversation>
{chat_history}
</conversation>

Follow up question: {query}
Rephrased question:
`;

const strParser = new StringOutputParser();

const createBasicWebSearchRetrieverChain = (llm: BaseChatModel) => {
  (llm as unknown as ChatOpenAI).temperature = 0;

  return RunnableSequence.from([
    PromptTemplate.fromTemplate(basicSearchRetrieverPrompt),
    llm,
    strParser,
    RunnableLambda.from(async (input: string) => {
      // const linksOutputParser = new LineListOutputParser({ key: 'links' });
      const questionOutputParser = new LineOutputParser({ key: 'question' });

      // const links = await linksOutputParser.parse(input);
      const question = await questionOutputParser.parse(input);

      const res = await searchSearxng(question, { language: 'en' });
      const documents = res.results.map((result) => {
        return new Document({
          pageContent: result.content,
          metadata: {
            title: result.title,
            url: result.url,
            ...(result.img_src && { img_src: result.img_src }),
          },
        });
      });

      return { query: question, docs: documents };
    }),
  ]);
};

const createBasicWebSearchAnsweringChain = (
  llm: BaseChatModel,
  embeddings: Embeddings,
) => {
  // Directly create the retriever chain without awaiting
  const basicWebSearchRetrieverChain = createBasicWebSearchRetrieverChain(llm);
  return basicWebSearchRetrieverChain;
};

const wordCount = async (content) => {
  const count = content.toString().replace(/\s+/g, ' ').split(' ');
  return count.length;
};

function cleanHTMLContent(html) {
  const $ = cheerio.load(html);
  // Remove unwanted elements
  $(
    'style, head, footer, aside, img, .ad, .advertisement, .promo, .sidebar, .comments, script, iframe, nav, button',
  ).remove();
  $(
    '.testimonial, .like-share, .like_share, .related-blog, .related_blog, .related-news,.related_news, .share-buttons, .share_buttons, .share-section, .share_section, .related-articles, .related_articles, .related-posts, .related_posts, .newsletter-signup, .newsletter_signup, .social-media, .social_media',
  ).remove();
  const headings = [];
  let promptContent = '';
  $('h2, h3, h4').each((index, element) => {
    const tag = element.name;
    const headingText = $(element).text().trim();
    let content = '';
    // Collect content only until the next heading of the same or higher level
    $(element)
      .nextUntil('h2, h3, h4')
      .each((i, sibling) => {
        // Remove inline styles and convert <a> tags to plain text
        $(sibling).find('[style]').removeAttr('style'); // Remove inline CSS
        $(sibling)
          .find('a')
          .each((i, link) => {
            $(link).replaceWith($(link).text()); // Convert <a> to plain text
          });
        // Append plain text content of the sibling
        content += $(sibling).text().trim() + ' ';
      });

    const heading = {
      tag: tag,
      text: headingText
        .replace(/\.css-[a-zA-Z0-9_-]+[{][^}]+[}]/g, '') // Remove CSS class definitions
        .replace(/\[h[23]\]/g, '') // Remove h2, h3 tags
        .replace(/^\d+\. /gm, ''),
      content: content
        .replace(/\s{2,}/g, '  ')
        .replace(/\n/g, '  ')
        .trim(),
      children: [],
    };
    heading?.content.length > 100 ? headings.push(heading) : '';
    if (heading?.content.length > 100) {
      const headingData =
        tag == 'h1'
          ? `# ${heading.text}`
          : tag == 'h2'
            ? `## ${heading.text}`
            : tag == 'h3'
              ? `### ${heading.text}`
              : tag == 'h4'
                ? `#### ${heading.text}`
                : tag == 'h5'
                  ? `##### ${heading.text}`
                  : `###### ${heading.text}`;

      promptContent = promptContent + headingData + '\n' + heading.content;
    }
  });
  return {
    promptContent:
      promptContent || $('body').text().replace(/\s+/g, ' ').trim(),
  };
}

// Function to fetch the full page content
const fetchPageContent = async (url): Promise<any> => {
  // Fetch the webpage content
  try {
    const dataExist = await checkDBdataExist(url);
    if (dataExist) {
      return {
        content: 'DataExist in DB',
      };
    } else {
      // Launch Puppeteer
      const browser = await puppeteer.launch({
        headless: true, // Opt into the new headless mode
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
        timeout: 80000,
        // dumpio: true, // Ensure dumpio is not enabled
      });
      const page = await browser.newPage();

      // Set a realistic user agent to avoid potential blocking
      await page.setUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.96 Safari/537.36',
      );

      // Navigate to the Reddit post
      await page.goto(url, { waitUntil: 'networkidle2' });

      const content = await page.content();

      await browser.close();

      const { promptContent } = cleanHTMLContent(content);
      const word_count = await wordCount(promptContent);
      return {
        content: promptContent,
        word_count,
      };
    }
  } catch (error) {
    await sendErrorSlackMessage(
      `*Error - Fetch page content * \n URL : ${url}`,
    );
    return {
      content: '',
    };
  }
};

const scrapeRedditPostAndComments = async (url) => {
  try {
    const dataExist = await checkDBdataExist(url);

    if (dataExist) {
      return {
        content: 'DataExist in DB',
      };
    } else {
      // Launch Puppeteer
      const browser = await puppeteer.launch({
        headless: true, // Use the new headless mode
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
        timeout: 80000, // Increase timeout to 60 seconds
        dumpio: true, // Print out all browser logs to the console
      });
      const page = await browser.newPage();

      // Set a realistic user agent to avoid potential blocking
      await page.setUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.96 Safari/537.36',
      );

      // Navigate to the Reddit post
      await page.goto(url, { waitUntil: 'networkidle2' });

      // Wait for the <main> tag to load
      await page.waitForSelector('main');
      // Extract the text content from the <main> tag
      const mainContent = await page.evaluate(async () => {
        const wordCount = async (content) => {
          const count = content.toString().replace(/\s+/g, ' ').split(' ');
          return count.length;
        };
        const title = document.querySelector('h1');
        if (title.innerText === '[deleted by user]') {
          return { content: '' };
        } else {
          const post = document.querySelector(
            'div.text-neutral-content',
          ) as HTMLElement;
          if (post.innerText.length < 100) {
            return { content: '' };
          }
          let Comment = '';
          // Use querySelectorAll to select all elements with the class 'shreddit-comment'
          const comments = document.querySelectorAll('shreddit-comment');

          // Iterate through the NodeList and log the inner text of each comment
          comments.forEach((comment, i) => {
            const element = comment as HTMLElement; // Cast to HTMLElement
            Comment =
              Comment +
              `Comment${i + 1} \n ${element.innerText.replace(/\w+\n•\n\d+mo ago\n/g, '').trim()} \n`;
          });
          if (Comment.length < 100) {
            return { content: '' };
          }
          const titleReddit = title.innerText.trim();
          const postReddit = post.innerText
            .replace(/\w+\n•\n\d+mo ago\n/g, '')
            .replace(/\b[Rr]eply\b/g, '')
            .trim();
          const commentReddit = Comment.replace(/\b[Rr]eply\b/g, '');
          let word_count = 0;
          word_count = word_count + (await wordCount(titleReddit));
          word_count = word_count + (await wordCount(postReddit));
          word_count = word_count + (await wordCount(commentReddit));
          return {
            content: `RedditPostTitle : ${titleReddit} \n\n RedditPost : ${postReddit} \n\n RedditComments : ${commentReddit}`,
            word_count,
          };
        }
      });

      await browser.close();
      return mainContent; // Print the extracted text content
    }
  } catch (error) {
    await sendErrorSlackMessage(
      `*Error - Fetch page content * \n URL : ${url}`,
    );
    console.log('Error:', error);
    return { content: '' };
  }
};

const basicWebSearch = async (
  query: any,
  history: BaseMessage[],
  llm: BaseChatModel,
  embeddings: Embeddings,
  type,
) => {
  try {
    if (type == 'url') {
      const basicWebSearchAnsweringChain = createBasicWebSearchAnsweringChain(
        llm,
        embeddings,
      );

      const stream = await basicWebSearchAnsweringChain.invoke({
        chat_history: history,
        query: query,
      });
      // Fetch full page content for each URL
      if (stream?.docs?.length > 0) {
        const limitedDocs = [];
        let count = 0;
        for (const doc of stream?.docs) {
          if (!doc.metadata.url.includes('//twitter')) {
            if (count < 5) {
              limitedDocs.push(doc.metadata.url);
              count += 1;
            } else {
              break;
            }
          }
        }
        const uniqueArray = [...new Set(limitedDocs)];
        return { urls: uniqueArray };
      }
    } else {
      const uniqueArray = query;
      const results = [];
      const output = [];

      if (uniqueArray?.length > 0) {
        for (const data of uniqueArray) {
          const url = data;
          const pageContent = url.includes('//twitter')
            ? { content: '' }
            : url.includes('reddit')
              ? await scrapeRedditPostAndComments(url)
              : await fetchPageContent(url); // Fetch content for each URL
          pageContent?.content === 'DataExist in DB'
            ? results.push({ url })
            : pageContent?.content
              ? results.push({
                  url,
                  pageContent,
                })
              : '';
        }
      }
      if (results?.length > 0) {
        for (const data of results) {
          const summaryData = await getSummaryData(data);
          if (summaryData) {
            output.push(summaryData);
          }
        }
      }
      return output;
    }
  } catch (err) {
    await sendErrorSlackMessage(`*Error - websearch * \n Title : ${query}`);
    console.log(`Error in websearch: ${err}`);
    return [{ err }];
  }
};

const handleWebSearch = async (
  message: any,
  history: BaseMessage[],
  llm: BaseChatModel,
  embeddings: Embeddings,
  type: string,
) => {
  const emitter = await basicWebSearch(message, history, llm, embeddings, type);
  return emitter;
};

export default handleWebSearch;
