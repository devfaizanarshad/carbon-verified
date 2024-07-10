import express from "express";
import bodyParser from "body-parser";
import dotenv from 'dotenv';
import cors from "cors";

import {
    dirname
} from "path";
import {
    fileURLToPath
} from "url";
import axios from "axios";
import {
    WebsiteCarbonCalculator,
    WebsiteCarbonCalculatorError
} from 'website-carbon-calculator';
import {
    co2
} from "@tgwf/co2";



dotenv.config();

// Getting the relative path dynamically to server
const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const port = 3100;

// Things required for sending requests
// Now you can access your environment variables like this:
const CarbonURL = process.env.CARBON_URL;
const PostLighthouseURL = process.env.POST_LIGHTHOUSE_URL;
const GetLighthouseURL = process.env.GET_LIGHTHOUSE_URL;
const API_TOKEN = process.env.API_TOKEN;
const carbon_API_KEY = process.env.CARBON_API_KEY;


// Middlewares for allowing access to CSS/JS files and body of request
app.use(cors())
app.use(express.static(__dirname + '/Public'));
app.use(bodyParser.urlencoded({
    extended: true
}));


const co2Emission = new co2();


//Function for calculating rating
function getRating(estimatedCO2) {
    if (estimatedCO2 <= 0.095) {
        return 'A+';
    } else if (estimatedCO2 <= 0.186) {
        return 'A';
    } else if (estimatedCO2 <= 0.341) {
        return 'B';
    } else if (estimatedCO2 <= 0.493) {
        return 'C';
    } else if (estimatedCO2 <= 0.656) {
        return 'D';
    } else {
        return 'F';
    }
}


// Function to make a request to Carbon API
async function getCarbonData(SearchURL, res) {
    console.log('getCarbonData Function Started')

    // const encodedUrl = encodeURIComponent(SearchURL);

    console.log(SearchURL)

    try {
        const websiteCarbonCalculator = new WebsiteCarbonCalculator({
            pagespeedApiKey: `${carbon_API_KEY}`
        });
        const result = await websiteCarbonCalculator.calculateByURL(SearchURL);

        console.log(result)

        console.log('getCarbonData Function Running!!!')

        const bytesSent = result.bytesTransferred;
        const greenHost = result.isGreenHost;

        const estimatedCO2 = co2Emission.perByte(bytesSent, greenHost);
        const pageWeightKB = (result.bytesTransferred / 1024).toFixed(2);

        console.log(`Sending a gigabyte had a carbon footprint of ${estimatedCO2.toFixed(3)} grams of CO2`);

        const rating = getRating(estimatedCO2);
        console.log('Website rating:', rating);
        console.log('Page Weight:', pageWeightKB);

        const data = {
            rating: rating,
            webCO2: estimatedCO2,
            pageweight: pageWeightKB
        }

        console.log('getCarbonData Function Completed')
        console.log(data);

        return data;
    } catch (error) {
        throw new Error('Failed to fetch carbon data');


    }
}



// Function to make a request to Lighthouse API and wait for the analysis to complete
async function getLighthouseData(SearchURL) {

    console.log('getLighthouseData Function Started')

    const lighthouseResponse = await axios.post(PostLighthouseURL, {
        url: SearchURL,
        "regions": [
            "us-west1"
        ]
    }, {
        headers: {
            'Authorization': `Bearer ${API_TOKEN}`,
        }
    });
    const uniqueID = lighthouseResponse.data.id;

    console.log(uniqueID);

    let lighthouseData = null;
    const retryDelay = 5000; // 5 seconds
    const maxRetries = 20;
    let retries = 0;

    while (retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));

        let config = {
            method: 'get',
            maxBodyLength: Infinity,
            url: 'https://api.lighthouse-metrics.com/v1/lighthouse/checks/657acdc6-4e0f-4331-a61c-ec647e53a113',
            headers: {
                'Authorization': 'Bearer PaBYk7RKAwLZ9Ggbwxn4fvCZ1ID49aMY'
            }
        };

        axios.request(config)
            .then((response) => {

                lighthouseData = response.data;

                console.log(JSON.stringify(response.data));
            })
            .catch((error) => {
                console.log(error);
            });


        if (lighthouseData && lighthouseData.runs && lighthouseData.runs.length > 0) {
            const state = lighthouseData.runs[0].state;
            console.log(`Attempt ${retries + 1}: State - ${state}`);
            if (state === 'succeeded') {
                console.log("Lighthouse analysis succeeded.");
                break;
            } else if (state === 'failed') {
                console.log("Lighthouse analysis failed.");
                break;
            }
        }

        retries++;
    }


    return lighthouseData;
}

// Route handler for the main route
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Route handler for the generateReport route
app.post('/generateReport', async (req, res, next) => {

    console.log('I am in a Find Route')
    // Extract the URL from the request body
    let SearchURL = req.body.URLSearch;

    // Check if the URL is empty or missing 'http://' or 'https://'
    if (!SearchURL) {
        throw new Error('Empty URL provided');
    } else {
        // Prepend 'http://' if the URL does not start with it
        if (!/^https?:\/\/|^http?:\/\//i.test(SearchURL)) {
            // Append 'http://' if not already specified
            SearchURL = 'http://' + SearchURL;

            console.log(SearchURL)
        }

        if (!/www\./i.test(SearchURL)) {
            SearchURL = SearchURL.replace(/^(http?:\/\/)/, '$1www.');
            console.log(SearchURL)

        }



    }

    let result = null;
    let SeoOptimizationValue = null;

    try {
        // Request to Carbon API
        result = await getCarbonData(SearchURL, res);

        // Request to Lighthouse API
        const lighthouseData = await getLighthouseData(SearchURL);
        console.log(lighthouseData.runs[0].performance);
        console.log(lighthouseData.runs[0].bestPractices);
        console.log(lighthouseData.runs[0].seo);

        // Extracting relevant information from the Lighthouse data for setting progressEndValue
        const seoScore = lighthouseData.runs[0].seo;
        const bestPracticesScore = lighthouseData.runs[0].bestPractices;
        const performanceScore = lighthouseData.runs[0].performance;
        const fcp = lighthouseData.runs[0].fcp / 1000;
        const si = lighthouseData.runs[0].si / 1000;
        const lcp = lighthouseData.runs[0].lcp / 1000;
        const tti = lighthouseData.runs[0].tti / 1000;
        const tbt = lighthouseData.runs[0].tbt / 1000;
        const cls = lighthouseData.runs[0].cls;

        console.log("FirsFirst Contentful Paint" + fcp);
        console.log("Speed Index" + si);
        console.log("Largest Contentful Paint" + lcp);

        // Set progressEndValue based on the received scores for each progress bar
        SeoOptimizationValue = {
            seoPerformance: seoScore,
            bestPractices: bestPracticesScore,
            seoScore: performanceScore,
            fcp: fcp,
            si: si,
            lcp: lcp,
            tti: tti,
            tbt: tbt,
            cls: cls
        };


    } catch (error) {
        next(error);
    }

    console.log(result)
    res.render('report.ejs', {
        list: result,
        seo: SeoOptimizationValue
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).redirect('/error.html'); // Redirect to error page on server error
});


app.use((req, res, next) => {
    res.status(404).redirect('/error.html'); // Redirect to error page on 404 error
});


// Start the server
app.listen(port, () => {
    console.log("Listening to port 3100");
});