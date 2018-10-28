const Alexa = require('ask-sdk-core');
const request = require('request');

const messages = {
  NOTIFY_MISSING_PERMISSIONS: 'Please enable Location permissions in the Amazon Alexa app.',
  NO_ADDRESS: 'It looks like you don\'t have an address set. You can set your address from the companion app.',
  ERROR: 'Uh Oh. Looks like something went wrong.',
  LOCATION_FAILURE: 'There was an error with the Device Address API. Please try again.',
  UNHANDLED: 'This skill doesn\'t support that. Please ask something else.',
};

const PERMISSIONS = ['read::alexa:device:all:address'];

// handlers

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
  },
  handle(handlerInput) {
    const { responseBuilder } = handlerInput;
    const speechText = "Welcome to Find Me Breakfast, Let's find you breakfast! Just ask, 'what\'s open?'";

    if (supportsDisplay(handlerInput)) {
      const title = `find Me Breakfast`;
      const bodyTemplate = 'BodyTemplate6';
      const primaryText = new Alexa.RichTextContentHelper()
        .withPrimaryText("Welcome to Find Me Breakfast.")
        .getTextContent();
      const hint = "whats open?"
      responseBuilder.addRenderTemplateDirective({
        type: bodyTemplate,
        backButton: 'visible',
        title,
        textContent: primaryText
      })
      .addHintDirective(hint)
    }

    return responseBuilder
      .speak(speechText)
      .reprompt(speechText)
      .getResponse();
  }
};

const FindDinerIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'FindDinerIntent';
  },
  async handle(handlerInput) {
    const { requestEnvelope, serviceClientFactory, responseBuilder } = handlerInput;
    const consentToken = requestEnvelope.context.System.user.permissions && requestEnvelope.context.System.user.permissions.consentToken;
    if (!consentToken) {
      return responseBuilder
        .speak(messages.NOTIFY_MISSING_PERMISSIONS)
        .withAskForPermissionsConsentCard(PERMISSIONS)
        .getResponse();
    }

    try {
      const { deviceId } = requestEnvelope.context.System.device;
      const deviceAddressServiceClient = serviceClientFactory.getDeviceAddressServiceClient();
      const address = await deviceAddressServiceClient.getFullAddress(deviceId);

      if (address.addressLine1 === null && address.stateOrRegion === null) {
        return responseBuilder.speak(messages.NO_ADDRESS).getResponse();
      } else {
        const {lat, lng} = await getDeviceLocation(address)

        let speechText = ''
        const diner = await searchForDiners(lat.toString(),lng.toString())

        speechText += `How does ${getTitle(diner.name)} sound? If you want another recomendation just say, 'show me somewhere different'. Enjoy breakfast!`;

        if (supportsDisplay(handlerInput)) {
          const image = new Alexa.ImageHelper()
            .addImageInstance(getImage(800, diner.photos[0].photo_reference))
            .getImage();
          const title = `${getTitle(diner.name)}`;
          const bodyTemplate = 'BodyTemplate2';
          const primaryText = new Alexa.RichTextContentHelper()
            .withPrimaryText(getDescription(diner.plus_code.global_code, diner.rating, diner.price_level))
            .getTextContent();
          responseBuilder.addRenderTemplateDirective({
            type: bodyTemplate,
            backButton: 'visible',
            image,
            title,
            textContent: primaryText,
          });
        }
        return responseBuilder.withStandardCard(
            `${diner.name}`,
            getStandardDescription(diner.plus_code.global_code, diner.rating, diner.price_level),
            getImage(400, diner.photos[0].photo_reference),
            getImage(800, diner.photos[0].photo_reference),
          )
          .speak(speechText)
          .reprompt(speechText)
          .getResponse();
      }
    } catch (error) {
      console.log(error)
      if (error.name !== 'ServiceError') {
        const response = responseBuilder.speak(messages.ERROR).getResponse();
        return response;
      }
      throw error;
    }
  }
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    const speechText = 'You can say hello to me!';

    return handlerInput.responseBuilder
      .speak(speechText)
      .reprompt(speechText)
      .getResponse();
  }
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent'
        || handlerInput.requestEnvelope.request.intent.name === 'AMAZON.StopIntent');
  },
  handle(handlerInput) {
    const speechText = 'Enjoy Breakfast!';

    return handlerInput.responseBuilder
      .speak(speechText)
      .getResponse();
  }
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    //any cleanup logic goes here
    return handlerInput.responseBuilder.getResponse();
  }
};

const UnhandledIntent = {
  canHandle() {
    return true;
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(messages.UNHANDLED)
      .reprompt(messages.UNHANDLED)
      .getResponse();
  },
};

// helper functions
const getDeviceLocation = (address) => {
  let locationString = `${address.addressLine1} ${address.city}, ${address.stateOrRegion} ${address.postalCode}`
  return new Promise((resolve, reject) => {
    request(`https://maps.googleapis.com/maps/api/geocode/json?address={A}&key=${process.env.API_KEY}`.replace('{A}', locationString), (error, response, body) => {
      resolve(JSON.parse(body)['results'][0]["geometry"]["location"])
    })
  })
}


const supportsDisplay = (handlerInput) => {
  const hasDisplay =
    handlerInput.requestEnvelope.context &&
    handlerInput.requestEnvelope.context.System &&
    handlerInput.requestEnvelope.context.System.device &&
    handlerInput.requestEnvelope.context.System.device.supportedInterfaces &&
    handlerInput.requestEnvelope.context.System.device.supportedInterfaces.Display;
  return hasDisplay;
}

const searchForDiners = (lat, lng) => {
  return new Promise((resolve, reject) => {
    request(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location={LAT},{LNG}&rankby=distance&type=restaurant&keyword=diner&opennow&rankby=distance&key=${process.env.API_KEY}`.replace('{LAT}', lat).replace('{LNG}', lng)
    , (error, response, body) => {
      let index = Math.floor(Math.random() * (19 - 0 + 1)) + 0;
      result = JSON.parse(body)['results'][index]
      resolve(result)
    });
  });
}

getTitle = (title) => {
  return title.replace("&", "&amp;").replace('"', '&quot;').replace("'", "&apos;").replace('<', '&lt;').replace('>', '&gt;')
}

const getDescription = (locationCode, rating, price) => {
  let returnString = `Search ${locationCode} in Google Maps, to get directions. <br/>`
  if(rating) returnString += `Rating: ${rating}/5 <br/>`
  if(price) returnString += `Price: ${price}/5`
  return returnString
}

const getStandardDescription = (locationCode, rating, price) => {
  return `Search ${locationCode} in Google Maps, to get directions. \n
  Rating: ${rating}/5 \n
  Price: ${price}/5
  `
}

const getImage = (width, location) => {
  return(`https://maps.googleapis.com/maps/api/place/photo?maxwidth={W}&photoreference={L}&key=${process.env.API_KEY}`)
    .replace('{W}', width)
    .replace('{L}', location);
}

const GetAddressError = {
  canHandle(handlerInput, error) {
    return error.name === 'ServiceError';
  },
  handle(handlerInput, error) {
    if (error.statusCode === 403) {
      return handlerInput.responseBuilder
        .speak(messages.NOTIFY_MISSING_PERMISSIONS)
        .withAskForPermissionsConsentCard(PERMISSIONS)
        .getResponse();
    }
    return handlerInput.responseBuilder
      .speak(messages.LOCATION_FAILURE)
      .reprompt(messages.LOCATION_FAILURE)
      .getResponse();
  },
};

// skill creation
let skill;

exports.handler = async (event, context) => {
  if (!skill) {
    skill = Alexa.SkillBuilders.custom()
      .withApiClient(new Alexa.DefaultApiClient())
      .addRequestHandlers(
        LaunchRequestHandler,
        FindDinerIntentHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        SessionEndedRequestHandler,
        UnhandledIntent
      )
      .addErrorHandlers(
        GetAddressError
      )
      .create();
  }

  const response = await skill.invoke(event, context);
  return response;
};
