// middleware/certificationHandler.js
import { formatCertifications } from "../utils/certificationFormatter.js";

/**
 * Process certifications from form data and match with uploaded files
 */
export const processCertifications = (req, res, next) => {
    try {
        console.log('Processing certifications...');
        console.log('Files received:', req.files ? req.files.length : 0);
        console.log('Body certifications:', req.body.certifications);
        
        // If no certifications in body, just proceed
        if (!req.body.certifications) {
            console.log('No certifications data found');
            return next();
        }
        
        let certificationsData = req.body.certifications;
        
        // Parse certifications if it's a JSON string
        if (typeof certificationsData === 'string') {
            try {
                certificationsData = JSON.parse(certificationsData);
                console.log('Parsed certifications from JSON string');
            } catch (e) {
                console.log('Failed to parse certifications as JSON, using as is');
            }
        }
        
        // Check if certifications is in array format (name[], issuedBy[], etc.)
        if (certificationsData && certificationsData.name && Array.isArray(certificationsData.name)) {
            console.log('Processing array format certifications');
            const formattedCerts = [];
            const files = req.files || [];
            let fileIndex = 0;
            
            for (let i = 0; i < certificationsData.name.length; i++) {
                if (certificationsData.name[i] && certificationsData.name[i].trim() !== "") {
                    const certFile = files[fileIndex];
                    
                    formattedCerts.push({
                        name: certificationsData.name[i],
                        issuedBy: certificationsData.issuedBy?.[i] || "",
                        issueDate: certificationsData.issueDate?.[i] || null,
                        expiryDate: certificationsData.expiryDate?.[i] || null,
                        documentName: certFile ? certFile.originalname : (certificationsData.documentName?.[i] || ""),
                        documentUrl: certFile ? certFile.path : (certificationsData.documentUrl?.[i] || null),
                        _id: certificationsData._id?.[i] || undefined
                    });
                    
                    if (certFile) fileIndex++;
                }
            }
            
            req.body.certifications = formattedCerts;
            console.log(`Formatted ${formattedCerts.length} certifications`);
        } 
        // Check if certifications is already an array of objects
        else if (Array.isArray(certificationsData)) {
            console.log('Processing array of objects format certifications');
            const files = req.files || [];
            
            const formattedCerts = certificationsData.map((cert, index) => ({
                ...cert,
                documentName: files[index] ? files[index].originalname : cert.documentName,
                documentUrl: files[index] ? files[index].path : cert.documentUrl
            }));
            
            req.body.certifications = formattedCerts;
            console.log(`Formatted ${formattedCerts.length} certifications`);
        }
        
        next();
    } catch (error) {
        console.error('Error processing certifications:', error);
        next(error);
    }
};