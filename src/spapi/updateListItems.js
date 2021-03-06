define([
    "jquery",
    "./getSiteUrl",
    "../sputils/doesMsgHaveError",
    "../sputils/getMsgError"
], function(
    $,
    getSiteUrl,
    doesMsgHaveError,
    getMsgError
){

    var
    /**
     * Makes updates to list items in Sharepoint Lists and Libraries. For more
     * information on this method, see {@link https://msdn.microsoft.com/en-us/library/lists.lists.updatelistitems(v=office.12).aspx}
     *
     * This method will process updates in batches and can be configured on input to
     * control the number of concurrent updates that it can issue.
     *
     * @function
     *
     * @param {Object} options
     *
     * @param {String} options.listName
     *
     * @param {String|Object|Array<Array>|Array<Object>|Array<String>} options.updates
     *  A String, Object or an Array containing any of those types. If defining XML strings,
     *  the &lt;Batch&gt; wrapper __SHOULD NOT__ be included.
     *
     * @param {Object} [options.webUrl=current_site]
     *
     * @param {String} [options.updateType='Update']
     *  Used when the updates parameter is a non-string. The value will be used
     *  to set the Cmd on the update. Valid values are 'Update' (default),
     *  'New' and 'Delete'. Note that when using 'Udpate' and 'Delete' your
     *  updates must include the ID property so that SharePoint knows on what
     *  item it needs to act on.
     *  {@link https://msdn.microsoft.com/en-us/library/ms459050(v=office.12).aspx}
     *
     * @param {String} [options.updateOnError='Continue']
     *  Value is used on the Batch element to indicate what should be done if
     *  an error is encountered. Valid values include 'Continue' (default) and
     *  'Return'. {@link https://msdn.microsoft.com/en-us/library/ms437562(v=office.12).aspx}

     * @param {Number} [options.batchSize=100]
     *  Number of updates per batch. Default is 100.
     *
     * @param {Number} [options.concurrency=2]
     *  Number of max concurrent updates allowed.
     *
     *
     * @return {jQuery.Promise}
     *      The promise returned is resolved with a {@link updateListItemsResponse}
     *      object.
     *
     * @example
     *
     * updateListItems({
     *      listName: "Tasks",
     *      updates: [
     *          {
     *              ID: "3",
     *              Title: "Updated title"
     *          },
     *          {
     *              ID: "4",
     *              Title: "Updated title for 4"
     *          }
     *      ]
     * })
     * .then(function(response){
     *      alert(response.message);
     * })
     *
     *
     */
    updateListItems = function (options) {

        var opt = $.extend({}, updateListItems.defaults, options, { counter: 1});

        if (!opt.webURL) {
            opt.webURL = getSiteUrl();

        } else if (opt.webURL.charAt(opt.webURL.length - 1) !== "/") {
            opt.webURL += "/";
        }

        // some backwards compatability for SPServices
        opt.updateType = opt.batchCmd || opt.updateType;

        // Get an array of Strings with all updates
        opt._updates = getUpdateArray(opt);

        return $.Deferred(function(dfd){
            var
            updatePromisesList  = [],
            batchProcessingDone = false,
            updatesInFlight     = 0,
            maxConcurrentUpds   = opt.concurrency,
            getBatchUpdateList  = function(){
                var
                count           = 0,
                xmlUpdateString = "";

                while (opt._updates.length && count < opt.batchSize) {
                    xmlUpdateString += opt._updates.shift();
                    count++;
                }

                if (!/<\/Batch>/.test(xmlUpdateString)) {
                    xmlUpdateString = '<Batch OnError="Continue">' + xmlUpdateString + '</Batch>';
                }

                if (!opt._updates.length) {
                    batchProcessingDone = true;
                }

                return xmlUpdateString;
            },
            onUpdateDone = function(){
                --updatesInFlight;

                // If we're all done, then resolve the overall updateListItems promise
                if (updatesInFlight === 0 && batchProcessingDone) {
                    resolveUpdateListItems();
                    return;
                }

                // if concurrency is not maxed out, then execute a batch update again
                if (updatesInFlight < maxConcurrentUpds){
                    execBatchUpdate();
                }
            },
            execBatchUpdate = function(){
                // If we are at the max concurrency, then exit...
                if (batchProcessingDone || updatesInFlight >= maxConcurrentUpds) {
                    return;
                }

                var
                updatePromise = $.ajax({
                    type:           "POST",
                    cache:          false,
                    async:          opt.async,
                    url:            opt.webURL + "_vti_bin/Lists.asmx",
                    beforeSend:     function(xhr) {
                        xhr.setRequestHeader(
                            'SOAPAction',
                            'http://schemas.microsoft.com/sharepoint/soap/UpdateListItems'
                        );
                    },
                    contentType:    "text/xml;charset=utf-8",
                    dataType:       "xml",
                    data:           "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
                        "<soap:Envelope xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\">" +
                        "<soap:Body><UpdateListItems xmlns=\"http://schemas.microsoft.com/sharepoint/soap/\">" +
                        "<listName>" + opt.listName + "</listName><updates>" +
                        getBatchUpdateList() +
                        "</updates></UpdateListItems></soap:Body></soap:Envelope>"
                });

                updatesInFlight++;
                updatePromise.always(onUpdateDone);
                updatePromisesList.push(updatePromise);

                // If we are not yet done, then call execBatchUpdate again
                if (!batchProcessingDone){
                    execBatchUpdate();
                }
            },
            resolveUpdateListItems = function(){
                var
                // Backwards compatibility
                // TODO: remove code in future release
                execBackwardsCompatibleCode = function(xdata, status, jqXHR){
                    if ($.isFunction(opt.completefunc)) {
                        try {
                            console.warn("updateListItems(): completefunc options is deprecated!");
                        } catch(e){}
                        opt.completefunc(xdata, status, jqXHR);
                    }
                },
                processAjaxResponses = function(reqArgs, isHttpError){
                    var
                    args            = Array.prototype.slice.call(reqArgs, 0),
                    isMultiRequest  = updatePromisesList.length > 1,

                    /**
                     * Response object returned by updateListItems. Note that if batch
                     * processing was applied, the `httpData` and `xhrRequest` properties
                     * will be arrays instead.
                     *
                     * @typedef updateListItemsResponse
                     *
                     * @property {String} status
                     *  The status of the update. Value will be
                     *  either 'error' or 'success'
                     *
                     * @property {String} message
                     *  The message string. For a status of success, this
                     *  will just be "Update successful.". For a status of
                     *  error, this will include the errors returned by sharepoint.
                     *
                     * @property {Object|jQuery.jqXHR|Array} httpData
                     *  The Data object returned from SP (ex. XML or JSON) when successful
                     *  or the jqXHR object when failure was encountered. Note that this
                     *  could be an array depending on whether updates were done in batches
                     *
                     * @property {Object|jQuery.jqXHR|Array} xhrRequest
                     *
                     */
                    response = {
                        status      : "success", //error || success
                        message     : "Update Successful.",
                        httpData    : isMultiRequest ?
                                        [] :
                                        isHttpError ?
                                            args[2] :
                                            args[0],
                        xhrRequest  : isMultiRequest ? [] : args[2]
                    };

                    // If multiple requests, then check each one of them for
                    // SP processing errors
                    if (!isMultiRequest) {
                        args = [ args ]; // make args array-of-arrays === [ [args] ]
                    }

                    args.forEach(function(reqResponse){
                        if (isMultiRequest) {
                            // for HTTP errors, we push the xhr object to the httpData attribute
                            response.httpData.push(
                                isHttpError ? reqResponse[2] : reqResponse[0]
                            );
                            response.xhrRequest.push(reqResponse[2]);
                        }

                        if (isHttpError) {
                            response.status     = "error";
                            response.message    = reqResponse[1] || "HTTP error.";
                            return;
                        }

                        if (doesMsgHaveError(reqResponse[0])) {
                            response.status = "error";
                            response.message = getMsgError(reqResponse[0]);
                        }

                    });

                    if (response.status === "error") {
                        execBackwardsCompatibleCode(response.httpData, response.status, response.xhrRequest);
                        dfd.rejectWith($, [response]);

                    } else {
                        execBackwardsCompatibleCode(response.httpData, response.status, response.xhrRequest);
                        dfd.resolveWith($, [response]);
                    }
                };

                // When all requests are done, then process the responses
                $.when.apply($, updatePromisesList)
                .then(function(){
                    processAjaxResponses(arguments, false);
                })
                .fail(function(){
                    processAjaxResponses(arguments, true);
                });
            };

            execBatchUpdate();
        }).promise(); //end: return promise

    }, //end: updateListItems()

    /**
     * Returns an array of String representing the updates that need
     * to be made. Handles the updates being defined in a variety of
     * ways: array-of-arrays, array-of-objects, array-of-strings, string.
     *
     * @private
     * @param {Object} options
     *
     * @return {Array<String>}
     */
    getUpdateArray = function(options){

        var updates = [],
            ofType   = typeof options.updates;

        function processArrayOfObjects(updArray) {

            var i,j, col,
                thisUpd = '';

            // Loop through the list of objects (updates)
            for(i=0,j=updArray.length; i<j; i++){

                thisUpd = '';

                // Build the fields to be updated for this update
                for (col in updArray[i]) {

                    if (updArray[i].hasOwnProperty(col)) {

                        thisUpd += '<Field Name="' + col + '">' +
                                  updArray[i][col] + '</Field>';

                    }

                }

                // If this column has fields to be updated, create
                // the method agregate around it
                if (thisUpd) {

                    updates.push(
                        '<Method ID="' + options.counter + '" Cmd="' +
                        options.updateType + '">' + thisUpd + '</Method>'
                    );

                    options.counter++;

                }

            }

        }

        // Array-of-arrays
        // 1 single update (outer-array) with multiple fields to be
        // updated (inner-arrays's)
        function processArrayOfArrays(updArray) {

            var thisUpd = '',
                i,j;

            for(i=0,j=updArray.length; i<j; i++){

                if ($.isArray(updArray[i])) {

                    thisUpd += '<Field Name="' + updArray[i][0] + '">' +
                              updArray[i][1] + '</Field>';

                }

            }

            if (thisUpd) {

                updates.push(
                    '<Method ID="' + options.counter + '" Cmd="' +
                    options.updateType + '">' + thisUpd + '</Method>'
                );

                options.counter++;

            }

        }

        // Backwards compatability to SPServices: if we don't have
        // options.updates defined, but we have .ID and .valuepairs,
        // Then do array-of-arrays
        if (!options.updates && options.ID && options.valuepairs) {

            options.valuepairs.push(["ID", options.ID]);
            processArrayOfArrays(options.valuepairs);

        // If options.updates is a string, then just add it as is to
        // the array
        } else if (ofType === "string"){

            updates.push(options.updates);

        } else if ($.isArray(options.updates) && options.updates.length) {

            ofType = typeof options.updates[0];

            // Array<Object>
            if (ofType === "object") {

                processArrayOfObjects(options.updates);

            // Array<String>
            } else if (ofType === "string") {

                updates.push.apply(updates, options.updates);


            // Array<Array>
            } else if ($.isArray(options.updates[0])) {

                processArrayOfArrays(options.updates);

            }

        }
        return updates;

    }; //end: getUpdateArray

    // Define defaults. User can change these on their function attachment.
    updateListItems.defaults = {
        listName:       '',
        webURL:         '',
        async:          true,
        completefunc:   null,
        updates:        '',
        updateType:     'Update',
        updateOnError:  'Continue',
        batchSize:      100,
        concurrency:    2
    };

    return updateListItems;

});
